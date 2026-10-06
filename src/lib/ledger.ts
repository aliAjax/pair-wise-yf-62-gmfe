import type { Bounds, Mission, Occupation, OfflineReport, SearchArea, TrackPoint } from './types';

/** 网格密度：每个搜索区切成 GRID × GRID 单元格统计覆盖率 */
export const GRID = 10;

export const pointInBounds = (p: { lat: number; lng: number }, b: Bounds): boolean =>
  p.lng >= b[0] && p.lng <= b[2] && p.lat >= b[1] && p.lat <= b[3];

export const boundsIntersection = (a: Bounds, b: Bounds): Bounds | null => {
  const w = Math.max(a[0], b[0]);
  const s = Math.max(a[1], b[1]);
  const e = Math.min(a[2], b[2]);
  const n = Math.min(a[3], b[3]);
  return w < e && s < n ? [w, s, e, n] : null;
};

export const boundsOverlap = (a: Bounds, b: Bounds): boolean => boundsIntersection(a, b) !== null;

/** 重叠区 pair key：两个 areaId 排序后 join，保证与顺序无关 */
export const overlapKey = (areaIdA: string, areaIdB: string): string =>
  [areaIdA, areaIdB].sort().join('|');

export interface OverlapPair {
  key: string;
  a: SearchArea;
  b: SearchArea;
  intersection: Bounds;
}

export const findOverlaps = (areas: SearchArea[]): OverlapPair[] => {
  const out: OverlapPair[] = [];
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const inter = boundsIntersection(areas[i].bounds, areas[j].bounds);
      if (inter) out.push({ key: overlapKey(areas[i].id, areas[j].id), a: areas[i], b: areas[j], intersection: inter });
    }
  }
  return out;
};

/**
 * 给定点位，返回其主责区。
 * - 不在任何区内：area = null
 * - 只在一个区内：area = 该区
 * - 在交叠水域：按 primaryByOverlap 找主责区，其余区按协同处理
 */
export function primaryAreaAtPoint(
  p: { lat: number; lng: number },
  areas: SearchArea[],
  primaryByOverlap: Record<string, string>
): { area: SearchArea | null; overlapped: boolean; otherAreas: SearchArea[] } {
  const containing = areas.filter((a) => pointInBounds(p, a.bounds));
  if (containing.length === 0) return { area: null, overlapped: false, otherAreas: [] };
  if (containing.length === 1) return { area: containing[0], overlapped: false, otherAreas: [] };

  for (const a of containing) {
    const isPrimary = containing
      .filter((b) => b.id !== a.id)
      .every((b) => primaryByOverlap[overlapKey(a.id, b.id)] === a.id);
    if (isPrimary) return { area: a, overlapped: true, otherAreas: containing.filter((x) => x.id !== a.id) };
  }
  // 未设定主责区时，兜底取第一个包含区
  return { area: containing[0], overlapped: true, otherAreas: containing.slice(1) };
}

/**
 * 判断航迹点是否计入某搜索区的覆盖率。
 * 条件：非晚到、已合并、在该区内、该区是该点位的主责区、
 * 且存在一条在该时刻有效的占用（单位确实被 tasked 到该区）。
 */
export function pointCountsForArea(
  point: TrackPoint,
  area: SearchArea,
  areas: SearchArea[],
  occupations: Occupation[],
  primaryByOverlap: Record<string, string>
): boolean {
  if (point.late || !point.merged) return false;
  if (!pointInBounds(point, area.bounds)) return false;
  const { area: primary } = primaryAreaAtPoint(point, areas, primaryByOverlap);
  if (!primary || primary.id !== area.id) return false;
  const t = new Date(point.time).getTime();
  return occupations.some(
    (o) =>
      o.assetId === point.assetId &&
      o.areaId === area.id &&
      o.status !== 'invalid' &&
      new Date(o.start).getTime() <= t &&
      (!o.end || t <= new Date(o.end).getTime())
  );
}

/**
 * 按实际航迹重算每个搜索区的覆盖率。
 * 交叠区单元格只归主责区；非主责区在该格不计覆盖（算协同）。
 */
export function recomputeCoverage(
  areas: SearchArea[],
  tracks: TrackPoint[],
  occupations: Occupation[],
  primaryByOverlap: Record<string, string>
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const area of areas) {
    const [w, s, e, n] = area.bounds;
    const cw = (e - w) / GRID;
    const ch = (n - s) / GRID;
    let eligible = 0;
    let covered = 0;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const center = { lng: w + (i + 0.5) * cw, lat: s + (j + 0.5) * ch };
        const { area: primary } = primaryAreaAtPoint(center, areas, primaryByOverlap);
        if (!primary || primary.id !== area.id) continue;
        eligible++;
        const cellBounds: Bounds = [w + i * cw, s + j * ch, w + (i + 1) * cw, s + (j + 1) * ch];
        const hit = tracks.some(
          (p) =>
            !p.late &&
            p.merged &&
            pointInBounds({ lat: p.lat, lng: p.lng }, cellBounds) &&
            pointCountsForArea(p, area, areas, occupations, primaryByOverlap)
        );
        if (hit) covered++;
      }
    }
    result[area.id] = eligible === 0 ? 0 : Math.round((covered / eligible) * 100);
  }
  return result;
}

/**
 * 由航迹派生协同记录：共享带航迹归主责区，另一区算协同。
 */
export function deriveCoordinations(
  tracks: TrackPoint[],
  areas: SearchArea[],
  occupations: Occupation[],
  primaryByOverlap: Record<string, string>
): Array<Omit<import('./types').Coordination, 'id'>> {
  const map = new Map<string, Omit<import('./types').Coordination, 'id'>>();
  for (const p of tracks) {
    if (p.late || !p.merged) continue;
    const containing = areas.filter((a) => pointInBounds(p, a.bounds));
    if (containing.length < 2) continue;
    const { area: primary, otherAreas } = primaryAreaAtPoint(p, areas, primaryByOverlap);
    if (!primary) continue;
    if (!pointCountsForArea(p, primary, areas, occupations, primaryByOverlap)) continue;
    for (const other of otherAreas) {
      if (!pointInBounds(p, other.bounds)) continue;
      const key = `${other.id}|${primary.id}|${p.assetId}|${p.businessNo}`;
      const existing = map.get(key);
      if (existing) {
        existing.pointIds.push(p.id);
      } else {
        map.set(key, {
          areaId: other.id,
          primaryAreaId: primary.id,
          assetId: p.assetId,
          businessNo: p.businessNo,
          pointIds: [p.id],
          time: p.time
        });
      }
    }
  }
  return Array.from(map.values());
}

/**
 * 生成蛇形搜索路径（确定性，便于测试）。
 * 沿经度方向分条带，纬度向往复扫海。
 */
export function buildSearchPath(area: SearchArea, count: number): Array<{ lat: number; lng: number }> {
  const [w, s, , n] = area.bounds;
  const strips = Math.max(2, Math.round(Math.sqrt(count)));
  const lngSpan = area.bounds[2] - w;
  const latSpan = n - s;
  const pts: Array<{ lat: number; lng: number }> = [];
  for (let k = 0; k < count; k++) {
    const t = count === 1 ? 0 : k / (count - 1);
    const strip = Math.min(strips - 1, Math.floor(t * strips));
    const within = (t * strips) % 1;
    const lng = w + (strip + 0.5) * (lngSpan / strips);
    const lat = strip % 2 === 0 ? s + within * latSpan : n - within * latSpan;
    pts.push({ lat, lng });
  }
  return pts;
}

/**
 * 升级回填：旧数据没有主责范围，按历史任务边界回填。
 * 对每个重叠 pair，历史上最早被任务占用的区定为主责区；
 * 时间相同则取任务数更多的区。
 */
export function backfillPrimary(areas: SearchArea[], missions: Mission[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const ov of findOverlaps(areas)) {
    const score = (areaId: string) => {
      const ms = missions.filter((m) => m.areaId === areaId);
      if (ms.length === 0) return { earliest: Infinity, count: 0 };
      const earliest = Math.min(...ms.map((m) => new Date(m.updatedAt).getTime()));
      return { earliest, count: ms.length };
    };
    const sa = score(ov.a.id);
    const sb = score(ov.b.id);
    let primary = ov.a.id;
    if (sb.earliest < sa.earliest || (sb.earliest === sa.earliest && sb.count > sa.count)) {
      primary = ov.b.id;
    }
    result[ov.key] = primary;
  }
  return result;
}

/** 判断离线报告是否为晚到报告：任务已关闭后收到的报告只补历史 */
export function isLateReport(report: OfflineReport, missions: Mission[]): boolean {
  const mission = missions.find((m) => m.businessNo === report.businessNo);
  if (!mission) return false;
  if (mission.status !== 'closed') return false;
  const latestPoint = Math.max(...report.points.map((p) => new Date(p.time).getTime()));
  return latestPoint > new Date(mission.updatedAt).getTime();
}
