import { describe, expect, it } from 'vitest';
import type { MergedTrack, Mission, RescueAsset, SearchArea, SharedBelt, TrackReport } from '../types';
import { buildLedger } from './ledger';
import { reconcileSchedule } from './schedule';
import { mergeReports } from './reports';
import { backfillBeltOwners, discoverBelts } from './belts';

const A: SearchArea = { id: 'A', name: 'A', bounds: [0, 0, 0.2, 0.2], status: 'active', rev: 1, updatedAt: 't' };
const B: SearchArea = { id: 'B', name: 'B', bounds: [0.16, 0, 0.36, 0.2], status: 'active', rev: 1, updatedAt: 't' };
const BELT_OVERLAP: [number, number, number, number] = [0.16, 0, 0.2, 0.2];

const beltA: SharedBelt = {
  id: 'belt:A~B',
  areaIds: ['A', 'B'],
  ownerAreaId: 'A',
  bounds: BELT_OVERLAP,
  updatedAt: 't'
};
const beltNone: SharedBelt = { ...beltA, ownerAreaId: '' };

const assets: RescueAsset[] = [
  { id: 's1', name: '船1', type: 'ship', status: 'assigned', lat: 0, lng: 0, lastSeen: 't', concurrentCapacity: 1 },
  { id: 's2', name: '船2', type: 'ship', status: 'ready', lat: 0, lng: 0, lastSeen: 't', concurrentCapacity: 1 }
];

function mission(over: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    bizNo: 'SAR-1',
    title: '任务',
    areaId: 'A',
    assetIds: ['s1'],
    status: 'in_progress',
    priority: 'normal',
    note: '',
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-01-01T01:00:00.000Z',
    rev: 1,
    updatedAt: 't',
    ...over
  };
}

function track(points: { t: string; lng: number; lat: number }[], late: string[] = []): MergedTrack {
  return {
    bizNo: 'SAR-1',
    assetId: 's1',
    reportIds: ['r1'],
    offline: false,
    points,
    latePointKeys: late.map((t) => `${t}|${points.find((p) => p.t === t)!.lng.toFixed(6)}|${points.find((p) => p.t === t)!.lat.toFixed(6)}`),
    receivedAt: 't'
  };
}

describe('交叠带先定主责 + 同时段唯一主责', () => {
  it('带内航迹归主责区，另一区不得重复计主责', () => {
    // 同一时段（00:00 槽）内，点同时覆盖A、B交叠带
    const t = track([
      { t: '2026-01-01T00:02:00Z', lng: 0.18, lat: 0.1 },
      { t: '2026-01-01T00:08:00Z', lng: 0.04, lat: 0.1 }
    ]);
    const ledger = buildLedger({ missions: [mission()], areas: [A, B], belts: [beltA], tracks: [t] });
    const row = ledger.rows.find((r) => r.slotStart === '2026-01-01T00:00:00.000Z')!;
    expect(row.ownerAreaId).toBe('A');
    // 主责格：带内点 + A区内部点都在A；B的主责覆盖不应出现带内格
    const statA = ledger.areaStats.find((s) => s.areaId === 'A')!;
    const statB = ledger.areaStats.find((s) => s.areaId === 'B')!;
    expect(statA.primaryCells).toBeGreaterThan(0);
    // B 没有任何主责格（带归A）
    expect(statB.primaryCells).toBe(0);
  });

  it('同一单位同一时段只计入一个搜索区（区内多点时取最多者）', () => {
    // 00:15 槽：B区内部2点，A区内部1点，无带内点 → 主责为B（即使任务计划区是A）
    const t = track([
      { t: '2026-01-01T00:16:00Z', lng: 0.04, lat: 0.04 },
      { t: '2026-01-01T00:20:00Z', lng: 0.24, lat: 0.04 },
      { t: '2026-01-01T00:26:00Z', lng: 0.28, lat: 0.16 }
    ]);
    const ledger = buildLedger({ missions: [mission()], areas: [A, B], belts: [beltA], tracks: [t] });
    const row = ledger.rows.find((r) => r.slotStart === '2026-01-01T00:15:00.000Z')!;
    expect(row.ownerAreaId).toBe('B');
    // A 内的点对A算协同
    expect(row.cooperationCells['A']?.length ?? 0).toBeGreaterThan(0);
  });

  it('飞偏到其他区算协同，飞偏到区外计漂移格', () => {
    const t = track([
      { t: '2026-01-01T00:31:00Z', lng: 0.28, lat: 0.1 },
      { t: '2026-01-01T00:37:00Z', lng: 0.8, lat: 0.8 }
    ]);
    const ledger = buildLedger({ missions: [mission()], areas: [A, B], belts: [beltA], tracks: [t] });
    const row = ledger.rows.find((r) => r.slotStart === '2026-01-01T00:30:00.000Z')!;
    expect(row.cooperationCells['B']?.length ?? 0).toBeGreaterThan(0);
    expect(row.outsideCells).toBeGreaterThan(0);
    expect(row.primaryCells.length).toBe(0);
  });

  it('交叠带未划主责时，带内格谁也不计并产生告警', () => {
    const t = track([{ t: '2026-01-01T00:03:00Z', lng: 0.18, lat: 0.1 }]);
    const ledger = buildLedger({ missions: [mission()], areas: [A, B], belts: [beltNone], tracks: [t] });
    expect(ledger.unownedBeltWarnings.length).toBe(1);
    const row = ledger.rows.find((r) => r.slotStart === '2026-01-01T00:00:00.000Z')!;
    expect(row.primaryCells.length).toBe(0);
    expect(row.unownedCells.length).toBeGreaterThan(0);
  });

  it('计划时段内无航迹 → 漏飞时段', () => {
    const ledger = buildLedger({ missions: [mission()], areas: [A, B], belts: [beltA], tracks: [] });
    expect(ledger.gaps.length).toBe(4); // 00:00,00:15,00:30,00:45
  });
});

describe('单位/搜索区变化 → 原占用失效，覆盖率重算', () => {
  it('业务编号航迹的单位已被撤换 → 记 detached，不进当前主责覆盖率', () => {
    const t = track([{ t: '2026-01-01T00:05:00Z', lng: 0.04, lat: 0.04 }]);
    const m = mission({ assetIds: ['s2'] }); // s1 已不在任务上
    const ledger = buildLedger({ missions: [m], areas: [A, B], belts: [beltA], tracks: [t] });
    const detached = ledger.rows.filter((r) => r.detached);
    expect(detached.length).toBeGreaterThan(0);
    expect(detached.every((r) => r.primaryCells.length === 0)).toBe(true);
    expect(ledger.areaStats.find((s) => s.areaId === 'A')!.primaryCells).toBe(0);
  });
});

describe('超出单位同时段容量 → 任务排队', () => {
  it('容量1的单位在重叠时段只能执行一个，第二个任务排队；关闭后自动递补', () => {
    const m1 = mission({ id: 'm1', bizNo: 'SAR-1', priority: 'urgent' });
    const m2 = mission({
      id: 'm2',
      bizNo: 'SAR-2',
      title: '任务2',
      priority: 'normal'
    });
    let out = reconcileSchedule({ missions: [m1, m2], assets });
    expect(out.find((m) => m.id === 'm1')!.status).toBe('in_progress');
    expect(out.find((m) => m.id === 'm2')!.status).toBe('queued');
    expect(out.find((m) => m.id === 'm2')!.queuedReason).toContain('容量1');

    // m2 从排队状态开始；m1 关闭后容量释放，m2 自动递补为已派发
    out = reconcileSchedule({
      missions: [
        { ...m1, status: 'closed', closedAt: '2026-01-01T00:10:00Z' },
        { ...m2, status: 'queued' }
      ],
      assets
    });
    expect(out.find((m) => m.id === 'm2')!.status).toBe('dispatched');
  });

  it('容量提升到2后不再排队', () => {
    const m1 = mission({ id: 'm1' });
    const m2 = mission({ id: 'm2', bizNo: 'SAR-2', title: '任务2' });
    const out = reconcileSchedule({
      missions: [m1, m2],
      assets: assets.map((a) => (a.id === 's1' ? { ...a, concurrentCapacity: 2 } : a))
    });
    expect(out.find((m) => m.id === 'm2')!.status).not.toBe('queued');
  });
});

describe('离线回传按业务编号合并，晚到只补历史', () => {
  it('同业务编号分片合并、重复 reportId 幂等去重', () => {
    const reports: TrackReport[] = [
      {
        reportId: 'r1',
        bizNo: 'SAR-1',
        assetId: 's1',
        offline: true,
        chunkIndex: 0,
        chunkTotal: 2,
        sentAt: '2026-01-01T00:30:00Z',
        points: [{ t: '2026-01-01T00:05:00Z', lng: 0.02, lat: 0.02 }]
      },
      {
        reportId: 'r2',
        bizNo: 'SAR-1',
        assetId: 's1',
        offline: true,
        chunkIndex: 1,
        chunkTotal: 2,
        sentAt: '2026-01-01T00:35:00Z',
        points: [{ t: '2026-01-01T00:20:00Z', lng: 0.04, lat: 0.04 }]
      },
      {
        reportId: 'r2', // 重传
        bizNo: 'SAR-1',
        assetId: 's1',
        offline: true,
        sentAt: '2026-01-01T00:36:00Z',
        points: [{ t: '2026-01-01T00:20:00Z', lng: 0.04, lat: 0.04 }]
      }
    ];
    const { tracks, ingested } = mergeReports([], reports, new Map());
    expect(tracks).toHaveLength(1);
    expect(tracks[0].points).toHaveLength(2);
    expect(tracks[0].reportIds).toEqual(['r1', 'r2']);
    expect(ingested.filter((i) => i.duplicate)).toHaveLength(1);
  });

  it('任务关闭后到达的旧报告，点进 latePointKeys；覆盖率中只进"含晚到"口径', () => {
    const closed = mission({ status: 'closed', closedAt: '2026-01-01T01:00:00Z' });
    const reports: TrackReport[] = [
      {
        reportId: 'late',
        bizNo: 'SAR-1',
        assetId: 's1',
        offline: true,
        sentAt: '2026-01-01T03:00:00Z',
        points: [{ t: '2026-01-01T00:50:00Z', lng: 0.04, lat: 0.04 }]
      }
    ];
    const { tracks } = mergeReports([], reports, new Map([['SAR-1', closed]]));
    expect(tracks[0].latePointKeys.length).toBe(1);

    const ledger = buildLedger({ missions: [closed], areas: [A, B], belts: [beltA], tracks });
    const statA = ledger.areaStats.find((s) => s.areaId === 'A')!;
    expect(statA.primaryPercent).toBe(0); // 当前口径不含晚到
    expect(statA.primaryPercentWithLate).toBeGreaterThan(0); // 历史账补记
  });
});

describe('旧数据升级：按历史任务边界回填主责', () => {
  it('发现交叠带后，以最早执行任务所在区回填主责', () => {
    const belts = discoverBelts([A, B], []);
    expect(belts).toHaveLength(1);
    expect(belts[0].ownerAreaId).toBe('');
    const missions = [
      mission({ areaId: 'B', windowStart: '2026-01-03T00:00:00Z' }),
      mission({ id: 'm0', areaId: 'A', windowStart: '2026-01-02T00:00:00Z' })
    ];
    const { belts: filled, unresolved } = backfillBeltOwners([A, B], belts, missions);
    expect(filled[0].ownerAreaId).toBe('A'); // A的历史任务更早
    expect(filled[0].backfilled).toBe(true);
    expect(unresolved).toHaveLength(0);
  });

  it('两区都没有历史任务时不臆造主责，列为待裁定', () => {
    const belts = discoverBelts([A, B], []);
    const { unresolved } = backfillBeltOwners([A, B], belts, []);
    expect(unresolved).toHaveLength(1);
  });
});
