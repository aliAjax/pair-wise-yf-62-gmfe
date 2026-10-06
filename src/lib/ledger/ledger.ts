import type {
  AreaStat,
  GapSlot,
  LedgerRow,
  MergedTrack,
  Mission,
  SearchArea,
  SharedBelt
} from '../types';
import { cellKey, enumerateSlots, expandTrack, pointInBounds, rasterizeArea, slotKey } from './geometry';
import { pointKey } from './reports';

interface Classified {
  key: string;
  /** 命中的已定主责交叠带（带内点） */
  belt: SharedBelt | null;
  /** 落在多个搜索区但没有任何共享带划主责，记录交叠区对 */
  unownedPairs: string[][];
  /** 落在哪些搜索区 */
  areas: string[];
}

function classifyPoint(lng: number, lat: number, areas: SearchArea[], belts: SharedBelt[]): Classified {
  const hitAreas = areas.filter((a) => pointInBounds(lng, lat, a.bounds)).map((a) => a.id);
  const belt =
    belts.find(
      (b) =>
        b.ownerAreaId &&
        b.areaIds.every((id) => hitAreas.includes(id)) &&
        pointInBounds(lng, lat, b.bounds)
    ) ?? null;
  const pairs: string[][] = [];
  if (hitAreas.length > 1 && !belt) {
    for (let i = 0; i < hitAreas.length; i++) {
      for (let j = i + 1; j < hitAreas.length; j++) {
        pairs.push([hitAreas[i], hitAreas[j]].sort());
      }
    }
  }
  return { key: cellKey(lng, lat), belt, unownedPairs: pairs, areas: hitAreas };
}

interface SlotBucket {
  start: string;
  end: string;
  /** 栅格（插值补格后），用于覆盖率与协同计格 */
  cells: Map<string, Classified>;
  /** 原始回传点的主责投票：带内点投带主责区，单区点投该区——决定槽主责 */
  votes: Map<string, number>;
  /** 该槽中含晚到补记点的格 */
  lateCells: Set<string>;
  source: LedgerRow['source'];
}

const SOURCE_RANK: Record<LedgerRow['source'], number> = {
  live: 3,
  'offline-merge': 2,
  'late-backfill': 1
};

function mergeSource(a: LedgerRow['source'], b: LedgerRow['source']): LedgerRow['source'] {
  return SOURCE_RANK[a] >= SOURCE_RANK[b] ? a : b;
}

export interface LedgerResult {
  rows: LedgerRow[];
  /** 漏飞时段：计划占用但该时段没有任何区内航迹 */
  gaps: GapSlot[];
  areaStats: AreaStat[];
  /** 落入交叠水域、但该带还没定主责：按交叠区对聚合 */
  unownedBeltWarnings: { areaIds: string[]; beltCells: number }[];
}

function addCoop(map: Map<string, Set<string>>, areaId: string, cell: string) {
  let set = map.get(areaId);
  if (!set) {
    set = new Set();
    map.set(areaId, set);
  }
  set.add(cell);
}

function mapOfSetsToRecord(map: Map<string, Set<string>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, set] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out[id] = [...set].sort();
  }
  return out;
}

/**
 * 按实际航迹记责任账。规则优先级（确定性，便于两边对账一致）：
 * 1) 交叠带先定主责：槽内若存在已定主责的带内格，带主责区即为该槽唯一主责区；
 * 2) 同一单位同一时段只计入一个搜索区：无带时取区内格最多者，平局取任务计划区，再平局取区id；
 * 3) 共享带航迹归主责区、另一区算协同；飞偏落入其他区的格也算协同，绝不重复计主责；
 * 4) 区外格计漂移；计划时段无区内航迹计漏飞；
 * 5) 单位/搜索区变化后，旧业务编号的航迹不再挂当前任务，单独记 detached，不进当前主责覆盖率。
 */
export function buildLedger(input: {
  missions: Mission[];
  areas: SearchArea[];
  belts: SharedBelt[];
  tracks: MergedTrack[];
}): LedgerResult {
  const { missions, areas, belts, tracks } = input;
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const rows: LedgerRow[] = [];
  const gaps: GapSlot[] = [];
  const unownedCellsByPair = new Map<string, Set<string>>();

  const noteUnowned = (pairs: string[][], key: string) => {
    for (const pair of pairs) {
      const pk = pair.join('|');
      let set = unownedCellsByPair.get(pk);
      if (!set) {
        set = new Set();
        unownedCellsByPair.set(pk, set);
      }
      set.add(key);
    }
  };

  const charged = missions.filter((m) => m.status !== 'draft' && m.status !== 'queued');
  // 排队任务无实际占用；已关闭任务保留账页，用于"晚到旧报告只补历史"
  // 仍被当前任务占用的航迹键（业务编号+单位），其余航迹视为失效占用
  const liveKeys = new Set<string>();

  for (const mission of charged) {
    if (!areaById.has(mission.areaId)) continue;
    for (const assetId of mission.assetIds) {
      liveKeys.add(`${mission.bizNo}|${assetId}`);
      const track = tracks.find((t) => t.bizNo === mission.bizNo && t.assetId === assetId);
      const source: LedgerRow['source'] = !track ? 'live' : track.offline ? 'offline-merge' : 'live';

      const bySlot = bucketTrack(track, source, areas, belts);

      for (const slot of enumerateSlots(mission.windowStart, mission.windowEnd)) {
        const bucket = bySlot.get(slot.start);
        const cells = bucket ? [...bucket.cells.values()] : [];
        const votes = bucket?.votes ?? new Map<string, number>();
        const beltOwnerVotes = new Map<string, number>();
        const areaVotes = new Map<string, number>();
        // 槽主责只按原始回传点投票；插值路径仅用于覆盖率补格
        for (const [candidate, n] of votes) {
          if (candidate.startsWith('belt:')) {
            const id = candidate.slice(5);
            beltOwnerVotes.set(id, (beltOwnerVotes.get(id) ?? 0) + n);
          } else {
            areaVotes.set(candidate, (areaVotes.get(candidate) ?? 0) + n);
          }
        }

        // 规则1：带内点先定主责——带主责区得票即强制为槽主责
        let owner: string | null = null;
        if (beltOwnerVotes.size) {
          owner = [...beltOwnerVotes.entries()].sort(
            (x, y) => y[1] - x[1] || x[0].localeCompare(y[0])
          )[0][0];
        }
        // 规则2：无带时按实际观测点多数取区，平局优先任务计划区
        if (!owner && areaVotes.size) {
          const top = [...areaVotes.entries()].sort(
            (x, y) =>
              y[1] - x[1] ||
              (x[0] === mission.areaId ? -1 : y[0] === mission.areaId ? 1 : 0) ||
              x[0].localeCompare(y[0])
          )[0][0];
          // 计划区一个点都没有 → 主责仍挂计划区（飞偏/漏飞有账主），其余点算协同
          owner = areaVotes.get(mission.areaId) ? top : mission.areaId;
        }
        if (!owner) owner = mission.areaId; // 无航迹/纯漂移/带未定主责时挂计划区

        const primary = new Set<string>();
        const primaryLate = new Set<string>();
        const coop = new Map<string, Set<string>>();
        const unowned = new Set<string>();
        let outsideCells = 0;

        for (const c of cells) {
          const cellLate = bucket?.lateCells.has(c.key) ?? false;
          if (c.unownedPairs.length) {
            unowned.add(c.key);
            noteUnowned(c.unownedPairs, c.key);
            // 未划主责的交叠格谁也不计，等划定后再算
            continue;
          }
          if (c.belt) {
            if (c.belt.ownerAreaId === owner && c.areas.includes(owner)) {
              primary.add(c.key); // 共享带航迹归主责区
              if (cellLate) primaryLate.add(c.key);
            } else {
              // 本槽主责不是该带主责：带内格对带主责区算协同，不抢主责
              if (c.belt.ownerAreaId !== owner) addCoop(coop, c.belt.ownerAreaId, c.key);
            }
            continue;
          }
          if (c.areas.length === 0) {
            outsideCells += 1; // 飞偏到区外
          } else if (c.areas.includes(owner)) {
            primary.add(c.key);
            if (cellLate) primaryLate.add(c.key);
          } else {
            for (const id of c.areas) addCoop(coop, id, c.key); // 飞偏到其他区算协同
          }
        }

        if (areaVotes.size === 0 && beltOwnerVotes.size === 0 && !unowned.size) {
          gaps.push({ bizNo: mission.bizNo, assetId, slotStart: slot.start, slotEnd: slot.end });
        }

        rows.push({
          key: `${mission.id}:${assetId}:${slot.start}`,
          bizNo: mission.bizNo,
          missionId: mission.id,
          assetId,
          slotStart: slot.start,
          slotEnd: slot.end,
          ownerAreaId: owner,
          primaryCells: [...primary].sort(),
          latePrimaryCells: [...primaryLate].sort(),
          cooperationCells: mapOfSetsToRecord(coop),
          unownedCells: [...unowned].sort(),
          outsideCells,
          detached: false,
          source: primary.size && primaryLate.size === primary.size ? 'late-backfill' : bucket?.source ?? 'live'
        });
      }
    }
  }

  // 规则5：业务编号已不挂当前单位（单位变化/任务关闭后旧单位回传）——原占用失效
  for (const track of tracks) {
    if (liveKeys.has(`${track.bizNo}|${track.assetId}`)) continue;
    const mission = missions.find((m) => m.bizNo === track.bizNo);
    if (!mission) continue;
    const source: LedgerRow['source'] = track.latePointKeys.length
      ? 'late-backfill'
      : track.offline
        ? 'offline-merge'
        : 'live';
    const bySlot = bucketTrack(track, source, areas, belts);
    for (const [, bucket] of bySlot) {
      const cells = [...bucket.cells.values()];
      const coop = new Map<string, Set<string>>();
      const unowned = new Set<string>();
      let outsideCells = 0;
      for (const c of cells) {
        if (c.unownedPairs.length) {
          unowned.add(c.key);
          noteUnowned(c.unownedPairs, c.key);
          continue;
        }
        if (c.areas.length === 0) outsideCells += 1;
        else for (const id of c.areas) addCoop(coop, id, c.key);
      }
      rows.push({
        key: `detached:${track.bizNo}:${track.assetId}:${bucket.start}`,
        bizNo: track.bizNo,
        missionId: mission.id,
        assetId: track.assetId,
        slotStart: bucket.start,
        slotEnd: bucket.end,
        ownerAreaId: '',
        primaryCells: [],
        latePrimaryCells: [],
        cooperationCells: mapOfSetsToRecord(coop),
        unownedCells: [...unowned].sort(),
        outsideCells,
        detached: true,
        source
      });
    }
  }

  return {
    rows,
    gaps,
    areaStats: buildAreaStats(areas, rows),
    unownedBeltWarnings: [...unownedCellsByPair.entries()]
      .map(([pair, set]) => ({ areaIds: pair.split('|'), beltCells: set.size }))
      .sort((a, b) => a.areaIds.join('|').localeCompare(b.areaIds.join('|')))
  };
}

function bucketTrack(
  track: MergedTrack | undefined,
  source: LedgerRow['source'],
  areas: SearchArea[],
  belts: SharedBelt[]
) {
  const bySlot = new Map<string, SlotBucket>();
  if (!track) return bySlot;
  const lateKeys = new Set(track.latePointKeys);

  const ensure = (s: string) => {
    let bucket = bySlot.get(s);
    if (!bucket) {
      const d = new Date(s);
      bucket = {
        start: s,
        end: new Date(d.getTime() + 15 * 60_000).toISOString(),
        cells: new Map(),
        votes: new Map(),
        lateCells: new Set(),
        source
      };
      bySlot.set(s, bucket);
    }
    return bucket;
  };

  // 1) 原始回传点：决定槽主责投票 + 晚到标记
  for (const raw of track.points) {
    const bucket = ensure(slotKey(raw.t));
    bucket.source = mergeSource(bucket.source, source);
    const c = classifyPoint(raw.lng, raw.lat, areas, belts);
    if (c.belt) {
      const k = `belt:${c.belt.ownerAreaId}`;
      bucket.votes.set(k, (bucket.votes.get(k) ?? 0) + 1);
    } else if (c.areas.length === 1) {
      bucket.votes.set(c.areas[0], (bucket.votes.get(c.areas[0]) ?? 0) + 1);
    }
    // 单区边界点（非交叠）进 cells 也要保留，下面 expandTrack 会覆盖
    if (!bucket.cells.has(c.key)) bucket.cells.set(c.key, c);
    if (lateKeys.has(pointKey(raw))) bucket.lateCells.add(c.key);
  }

  // 2) 插值补格：只用于覆盖率，不产生主责投票，避免高速穿越带内抢主责
  for (const p of expandTrack(track.points)) {
    const bucket = ensure(slotKey(p.t));
    bucket.source = mergeSource(bucket.source, source);
    const c = classifyPoint(p.lng, p.lat, areas, belts);
    if (!bucket.cells.has(c.key)) bucket.cells.set(c.key, c);
    if (lateKeys.has(pointKey(p))) bucket.lateCells.add(c.key);
  }
  for (const raw of track.points) {
    if (!lateKeys.has(pointKey(raw))) continue;
    const bucket = bySlot.get(slotKey(raw.t));
    bucket?.lateCells.add(cellKey(raw.lng, raw.lat));
  }
  return bySlot;
}

export function buildAreaStats(areas: SearchArea[], rows: LedgerRow[]): AreaStat[] {
  return areas.map((area) => {
    const total = rasterizeArea(area.bounds).size || 1;
    const primary = new Set<string>();
    const primaryWithLate = new Set<string>();
    const coop = new Set<string>();
    for (const row of rows.filter((r) => r.ownerAreaId === area.id && !r.detached)) {
      const lateSet = new Set(row.latePrimaryCells);
      for (const c of row.primaryCells) {
        primaryWithLate.add(c); // 晚到旧报告补历史
        if (!lateSet.has(c)) primary.add(c); // 当前口径不含晚到
      }
    }
    for (const row of rows) {
      row.cooperationCells[area.id]?.forEach((c) => coop.add(c));
    }
    const pct = (set: Set<string>) => Math.round((set.size / total) * 1000) / 10;
    return {
      areaId: area.id,
      totalCells: total,
      primaryCells: primary.size,
      cooperationCells: coop.size,
      primaryPercent: Math.min(100, pct(primary)),
      cooperationPercent: Math.min(100, pct(coop)),
      primaryPercentWithLate: Math.min(100, pct(primaryWithLate)),
      revised: area.rev > 1
    };
  });
}
