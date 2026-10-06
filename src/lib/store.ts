'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AreaStatus,
  AssetStatus,
  AssetType,
  EventLog,
  Mission,
  MissionStatus,
  Occupation,
  OfflineReport,
  QueueEntry,
  RescueAsset,
  SearchArea,
  TrackPoint
} from './types';
import { backfillPrimary, buildSearchPath, deriveCoordinations, recomputeCoverage } from './ledger';

const now = Date.now();
const iso = () => new Date().toISOString();

const defaultCapacity = (type: AssetType): number => {
  switch (type) {
    case 'ship':
      return 2;
    case 'shore':
      return 3;
    default:
      return 1;
  }
};

const initialAreas: SearchArea[] = [
  { id: 'area-a', name: 'A区 · 最后目击点', bounds: [121.42, 30.65, 121.68, 30.88], status: 'active', coverage: 0 },
  { id: 'area-b', name: 'B区 · 北向漂流', bounds: [121.64, 30.82, 121.96, 31.06], status: 'planned', coverage: 0 }
];
const initialAssets: RescueAsset[] = [
  { id: 'ship-01', name: '海巡071', type: 'ship', status: 'assigned', lat: 30.75, lng: 121.55, lastSeen: new Date(now - 35_000).toISOString(), capacity: 2 },
  { id: 'heli-02', name: '救助B-712', type: 'helicopter', status: 'ready', lat: 30.82, lng: 121.73, lastSeen: new Date(now - 7 * 60_000).toISOString(), capacity: 1 },
  { id: 'drone-03', name: '无人机D-9', type: 'drone', status: 'offline', lat: 30.69, lng: 121.61, lastSeen: new Date(now - 18 * 60_000).toISOString(), capacity: 1 }
];
const initialMissions: Mission[] = [
  { id: 'mission-1', businessNo: 'biz-001', title: 'A区扇形搜索', areaId: 'area-a', assetIds: ['ship-01', 'drone-03'], status: 'in_progress', priority: 'urgent', note: '优先核验橙色漂浮物', updatedAt: new Date(now - 6 * 60_000).toISOString() }
];
const initialEvents: EventLog[] = [
  { id: 'event-1', time: new Date(now - 15 * 60_000).toISOString(), actor: '指挥员', message: 'A区任务下发，海巡071开始扇形搜索' },
  { id: 'event-2', time: new Date(now - 6 * 60_000).toISOString(), actor: '无人机D-9', message: '链路中断，最后位置已标记为过期' }
];
const initialOccupations: Occupation[] = initialMissions
  .filter((m) => m.status === 'in_progress' || m.status === 'dispatched')
  .flatMap((m) =>
    m.assetIds.map((assetId) => ({
      id: crypto.randomUUID(),
      assetId,
      areaId: m.areaId,
      businessNo: m.businessNo,
      start: m.updatedAt,
      status: 'active' as const
    }))
  );
const initialPrimary = backfillPrimary(initialAreas, initialMissions);

/** 为任务建立占用：同单位同时段只计入一个搜索区（异区占用失效），超出容量则排队 */
function buildOccupations(
  prev: Occupation[],
  assets: RescueAsset[],
  mission: { id: string; businessNo: string; areaId: string; assetIds: string[] },
  nowIso: string
): { occupations: Occupation[]; queue: QueueEntry[]; invalidated: string[] } {
  const invalidated: string[] = [];
  const afterInvalidate = prev.map((o) => {
    if (o.status === 'active' && o.areaId !== mission.areaId && mission.assetIds.includes(o.assetId)) {
      invalidated.push(o.id);
      return { ...o, status: 'invalid' as const, end: nowIso, reason: '单位/搜索区变化，原占用失效' };
    }
    return o;
  });
  const queue: QueueEntry[] = [];
  const created: Occupation[] = [];
  for (const assetId of mission.assetIds) {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) continue;
    const activeSame = afterInvalidate.filter(
      (o) => o.assetId === assetId && o.status === 'active' && o.areaId === mission.areaId
    );
    if (activeSame.length >= asset.capacity) {
      queue.push({ id: crypto.randomUUID(), businessNo: mission.businessNo, missionId: mission.id, assetId, areaId: mission.areaId, reason: 'capacity', queuedAt: nowIso });
    } else {
      created.push({ id: crypto.randomUUID(), assetId, areaId: mission.areaId, businessNo: mission.businessNo, start: nowIso, status: 'active' });
    }
  }
  return { occupations: [...afterInvalidate, ...created], queue, invalidated };
}

/** 容量腾出后，把排队中的任务补入占用 */
function reconcileQueue(
  occupations: Occupation[],
  assets: RescueAsset[],
  queue: QueueEntry[],
  nowIso: string
): { occupations: Occupation[]; queue: QueueEntry[]; promoted: string[] } {
  const promoted: string[] = [];
  const created: Occupation[] = [];
  const remaining: QueueEntry[] = [];
  for (const entry of queue) {
    const asset = assets.find((a) => a.id === entry.assetId);
    if (!asset) {
      remaining.push(entry);
      continue;
    }
    const activeSame = occupations.filter((o) => o.assetId === entry.assetId && o.status === 'active' && o.areaId === entry.areaId);
    if (activeSame.length < asset.capacity) {
      created.push({ id: crypto.randomUUID(), assetId: entry.assetId, areaId: entry.areaId, businessNo: entry.businessNo, start: nowIso, status: 'active' });
      promoted.push(entry.id);
    } else {
      remaining.push(entry);
    }
  }
  return { occupations: [...occupations, ...created], queue: remaining, promoted };
}

interface CommandState {
  areas: SearchArea[];
  assets: RescueAsset[];
  missions: Mission[];
  events: EventLog[];
  tracks: TrackPoint[];
  occupations: Occupation[];
  offlineReports: OfflineReport[];
  queue: QueueEntry[];
  primaryByOverlap: Record<string, string>;
  offline: boolean;
  lowBandwidth: boolean;
  setAreaStatus: (id: string, status: AreaStatus) => void;
  setAssetStatus: (id: string, status: AssetStatus) => void;
  setMissionStatus: (id: string, status: MissionStatus) => void;
  dispatchMission: (input: { title: string; areaId: string; assetIds: string[]; priority: 'normal' | 'urgent'; note: string }) => void;
  updateMissionScope: (id: string, changes: { areaId?: string; assetIds?: string[] }) => void;
  simulateOnlineTrack: (missionId: string) => void;
  simulateOfflineReturn: (missionId: string) => void;
  mergeOfflineReports: () => void;
  setPrimaryArea: (pairKey: string, areaId: string) => void;
  promoteFromQueue: () => void;
  toggleOffline: () => void;
  toggleBandwidth: () => void;
}

export const useCommandStore = create<CommandState>()(
  persist(
    (set, get) => ({
      areas: initialAreas,
      assets: initialAssets,
      missions: initialMissions,
      events: initialEvents,
      tracks: [],
      occupations: initialOccupations,
      offlineReports: [],
      queue: [],
      primaryByOverlap: initialPrimary,
      offline: false,
      lowBandwidth: false,

      setAreaStatus: (id, status) =>
        set((state) => ({
          areas: state.areas.map((area) => (area.id === id ? { ...area, status } : area)),
          events: [{ id: crypto.randomUUID(), time: iso(), actor: '指挥员', message: `搜索区 ${id} 状态改为 ${status}` }, ...state.events]
        })),

      setAssetStatus: (id, status) =>
        set((state) => ({
          assets: state.assets.map((asset) => (asset.id === id ? { ...asset, status, lastSeen: iso() } : asset)),
          events: [{ id: crypto.randomUUID(), time: iso(), actor: '值班员', message: `${id} 状态改为 ${status}，已生成恢复记录` }, ...state.events]
        })),

      setMissionStatus: (id, status) =>
        set((state) => {
          const mission = state.missions.find((m) => m.id === id);
          if (!mission) return state;
          let occupations = state.occupations;
          let queue = state.queue;
          const events: EventLog[] = [];
          if (status === 'closed') {
            occupations = occupations.map((o) =>
              o.businessNo === mission.businessNo && o.status === 'active' ? { ...o, status: 'closed' as const, end: iso() } : o
            );
            const rec = reconcileQueue(occupations, state.assets, queue, iso());
            occupations = rec.occupations;
            queue = rec.queue;
            events.push({ id: crypto.randomUUID(), time: iso(), actor: '指挥员', message: `任务“${mission.title}”已关闭，占用释放并重算覆盖率` });
          } else if (status === 'in_progress' || status === 'dispatched') {
            const hasActive = occupations.some((o) => o.businessNo === mission.businessNo && o.status === 'active');
            if (!hasActive) {
              const built = buildOccupations(occupations, state.assets, mission, iso());
              occupations = built.occupations;
              queue = [...built.queue, ...queue];
              if (built.queue.length) events.push({ id: crypto.randomUUID(), time: iso(), actor: '值班员', message: `任务“${mission.title}”超出单位容量，${built.queue.length} 项排队` });
            }
            events.push({ id: crypto.randomUUID(), time: iso(), actor: '指挥员', message: `任务“${mission.title}”状态改为 ${status}` });
          }
          const coverage = recomputeCoverage(state.areas, state.tracks, occupations, state.primaryByOverlap);
          return {
            missions: state.missions.map((m) => (m.id === id ? { ...m, status, updatedAt: iso() } : m)),
            areas: state.areas.map((a) => ({ ...a, coverage: coverage[a.id] ?? a.coverage })),
            occupations,
            queue,
            events: [...events, ...state.events]
          };
        }),

      dispatchMission: (input) =>
        set((state) => {
          const mission: Mission = {
            id: crypto.randomUUID(),
            businessNo: `biz-${crypto.randomUUID()}`,
            ...input,
            status: 'dispatched',
            updatedAt: iso()
          };
          const built = buildOccupations(state.occupations, state.assets, mission, iso());
          const coverage = recomputeCoverage(state.areas, state.tracks, built.occupations, state.primaryByOverlap);
          const events: EventLog[] = [
            { id: crypto.randomUUID(), time: iso(), actor: '指挥员', message: `任务“${input.title}”已派发（业务编号 ${mission.businessNo}）` }
          ];
          if (built.invalidated.length) events.push({ id: crypto.randomUUID(), time: iso(), actor: '值班员', message: `${built.invalidated.length} 条异区占用失效，已重算覆盖率` });
          if (built.queue.length) events.push({ id: crypto.randomUUID(), time: iso(), actor: '值班员', message: `超出单位同时段容量，${built.queue.length} 项任务排队` });
          return {
            missions: [mission, ...state.missions],
            assets: state.assets.map((asset) => (input.assetIds.includes(asset.id) ? { ...asset, status: 'assigned' as const } : asset)),
            occupations: built.occupations,
            queue: [...built.queue, ...state.queue],
            areas: state.areas.map((a) => ({ ...a, coverage: coverage[a.id] ?? a.coverage })),
            events: [...events, ...state.events]
          };
        }),

      updateMissionScope: (id, changes) =>
        set((state) => {
          const mission = state.missions.find((m) => m.id === id);
          if (!mission) return state;
          const updated: Mission = { ...mission, ...changes, updatedAt: iso() };
          // 原占用失效：单位或搜索区变化后，不再匹配的占用作废
          let occupations = state.occupations.map((o) => {
            if (o.businessNo !== mission.businessNo || o.status !== 'active') return o;
            const stillMatches = updated.assetIds.includes(o.assetId) && o.areaId === updated.areaId;
            if (!stillMatches) return { ...o, status: 'invalid' as const, end: iso(), reason: '任务范围变更，原占用失效' };
            return o;
          });
          const built = buildOccupations(occupations, state.assets, updated, iso());
          occupations = built.occupations;
          const coverage = recomputeCoverage(state.areas, state.tracks, occupations, state.primaryByOverlap);
          const events: EventLog[] = [
            { id: crypto.randomUUID(), time: iso(), actor: '指挥员', message: `任务“${mission.title}”范围变更，${built.invalidated.length} 条原占用失效并已重算覆盖率` }
          ];
          if (built.queue.length) events.push({ id: crypto.randomUUID(), time: iso(), actor: '值班员', message: `超出单位同时段容量，${built.queue.length} 项任务排队` });
          return {
            missions: state.missions.map((m) => (m.id === id ? updated : m)),
            occupations,
            queue: [...built.queue, ...state.queue],
            areas: state.areas.map((a) => ({ ...a, coverage: coverage[a.id] ?? a.coverage })),
            events: [...events, ...state.events]
          };
        }),

      simulateOnlineTrack: (missionId) =>
        set((state) => {
          const mission = state.missions.find((m) => m.id === missionId);
          const area = state.areas.find((a) => a.id === mission?.areaId);
          if (!mission || !area) return state;
          const path = buildSearchPath(area, 36);
          const base = Date.now();
          const newTracks: TrackPoint[] = [];
          const newReports: OfflineReport[] = [];
          mission.assetIds.forEach((assetId) => {
            const asset = state.assets.find((a) => a.id === assetId);
            const points = path.map((p, i) => ({
              lat: p.lat + (Math.random() - 0.5) * 0.02,
              lng: p.lng + (Math.random() - 0.5) * 0.02,
              time: new Date(base - (path.length - i) * 30_000).toISOString()
            }));
            if (asset?.status === 'offline') {
              newReports.push({
                id: crypto.randomUUID(),
                businessNo: mission.businessNo,
                assetId,
                points,
                receivedAt: iso(),
                merged: false,
                late: mission.status === 'closed'
              });
            } else {
              points.forEach((p) =>
                newTracks.push({ id: crypto.randomUUID(), businessNo: mission.businessNo, assetId, lat: p.lat, lng: p.lng, time: p.time, source: 'online', late: false, merged: true })
              );
            }
          });
          const tracks = [...newTracks, ...state.tracks];
          const reports = [...newReports, ...state.offlineReports];
          const coverage = recomputeCoverage(state.areas, tracks, state.occupations, state.primaryByOverlap);
          const events: EventLog[] = [
            { id: crypto.randomUUID(), time: iso(), actor: '值班员', message: `任务“${mission.title}”实际航迹回传 ${newTracks.length} 点，覆盖率已重算` }
          ];
          if (newReports.length) events.push({ id: crypto.randomUUID(), time: iso(), actor: '值班员', message: `${newReports.length} 个单位离线，航迹存入离线回传箱（按业务编号 ${mission.businessNo} 待合并）` });
          return {
            tracks,
            offlineReports: reports,
            areas: state.areas.map((a) => ({ ...a, coverage: coverage[a.id] ?? a.coverage })),
            events: [...events, ...state.events]
          };
        }),

      simulateOfflineReturn: (missionId) =>
        set((state) => {
          const mission = state.missions.find((m) => m.id === missionId);
          const area = state.areas.find((a) => a.id === mission?.areaId);
          if (!mission || !area) return state;
          const path = buildSearchPath(area, 36);
          const base = Date.now();
          const reports: OfflineReport[] = mission.assetIds.map((assetId) => ({
            id: crypto.randomUUID(),
            businessNo: mission.businessNo,
            assetId,
            points: path.map((p, i) => ({
              lat: p.lat + (Math.random() - 0.5) * 0.02,
              lng: p.lng + (Math.random() - 0.5) * 0.02,
              time: new Date(base - (path.length - i) * 30_000).toISOString()
            })),
            receivedAt: iso(),
            merged: false,
            late: mission.status === 'closed'
          }));
          return {
            offlineReports: [...reports, ...state.offlineReports],
            events: [
              { id: crypto.randomUUID(), time: iso(), actor: '值班员', message: `离线回传 ${reports.length} 份已入箱（业务编号 ${mission.businessNo}），合并后补入台账` },
              ...state.events
            ]
          };
        }),

      mergeOfflineReports: () =>
        set((state) => {
          const pending = state.offlineReports.filter((r) => !r.merged);
          if (pending.length === 0) return state;
          const newTracks: TrackPoint[] = [];
          const mergedReports: OfflineReport[] = [];
          for (const report of pending) {
            report.points.forEach((p) =>
              newTracks.push({
                id: crypto.randomUUID(),
                businessNo: report.businessNo,
                assetId: report.assetId,
                lat: p.lat,
                lng: p.lng,
                time: p.time,
                source: 'offline',
                late: report.late,
                merged: true
              })
            );
            mergedReports.push({ ...report, merged: true });
          }
          const tracks = [...newTracks, ...state.tracks];
          const offlineReports = state.offlineReports.map((r) => (r.merged ? r : mergedReports.find((m) => m.id === r.id) ?? r));
          const coverage = recomputeCoverage(state.areas, tracks, state.occupations, state.primaryByOverlap);
          const lateCount = pending.filter((r) => r.late).length;
          const events: EventLog[] = [
            { id: crypto.randomUUID(), time: iso(), actor: '值班员', message: `离线回传按业务编号合并 ${pending.length} 份、${newTracks.length} 点入台账` }
          ];
          if (lateCount) events.push({ id: crypto.randomUUID(), time: iso(), actor: '值班员', message: `其中 ${lateCount} 份为晚到旧报告，只补历史，不计覆盖率` });
          return {
            tracks,
            offlineReports,
            areas: state.areas.map((a) => ({ ...a, coverage: coverage[a.id] ?? a.coverage })),
            events: [...events, ...state.events]
          };
        }),

      setPrimaryArea: (pairKey, areaId) =>
        set((state) => {
          const primaryByOverlap = { ...state.primaryByOverlap, [pairKey]: areaId };
          const coverage = recomputeCoverage(state.areas, state.tracks, state.occupations, primaryByOverlap);
          return {
            primaryByOverlap,
            areas: state.areas.map((a) => ({ ...a, coverage: coverage[a.id] ?? a.coverage })),
            events: [
              { id: crypto.randomUUID(), time: iso(), actor: '指挥员', message: `交叠水域主责区已指定，共享带航迹归主责区、另一区算协同，覆盖率已重算` },
              ...state.events
            ]
          };
        }),

      promoteFromQueue: () =>
        set((state) => {
          const rec = reconcileQueue(state.occupations, state.assets, state.queue, iso());
          if (rec.promoted.length === 0) return state;
          const coverage = recomputeCoverage(state.areas, state.tracks, rec.occupations, state.primaryByOverlap);
          return {
            occupations: rec.occupations,
            queue: rec.queue,
            areas: state.areas.map((a) => ({ ...a, coverage: coverage[a.id] ?? a.coverage })),
            events: [
              { id: crypto.randomUUID(), time: iso(), actor: '值班员', message: `容量腾出，${rec.promoted.length} 项排队任务已补入占用` },
              ...state.events
            ]
          };
        }),

      toggleOffline: () => set((state) => ({ offline: !state.offline })),
      toggleBandwidth: () => set((state) => ({ lowBandwidth: !state.lowBandwidth }))
    }),
    {
      name: 'maritime-command-v2',
      version: 2,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<CommandState>;
        const areas = state.areas ?? initialAreas;
        const missions = (state.missions ?? initialMissions).map((m) => ({ ...m, businessNo: m.businessNo ?? m.id }));
        const assets = (state.assets ?? initialAssets).map((a) => ({ ...a, capacity: a.capacity ?? defaultCapacity(a.type) }));
        const tracks = state.tracks ?? [];
        const occupations =
          state.occupations && state.occupations.length > 0
            ? state.occupations
            : missions
                .filter((m) => m.status === 'in_progress' || m.status === 'dispatched')
                .flatMap((m) =>
                  m.assetIds.map((assetId) => ({
                    id: crypto.randomUUID(),
                    assetId,
                    areaId: m.areaId,
                    businessNo: m.businessNo,
                    start: m.updatedAt,
                    status: 'active' as const
                  }))
                );
        const offlineReports = state.offlineReports ?? [];
        const queue = state.queue ?? [];
        const primaryByOverlap =
          state.primaryByOverlap && Object.keys(state.primaryByOverlap).length > 0
            ? state.primaryByOverlap
            : backfillPrimary(areas, missions);
        const coverage = recomputeCoverage(areas, tracks, occupations, primaryByOverlap);
        return {
          ...state,
          areas: areas.map((a) => ({ ...a, coverage: coverage[a.id] ?? a.coverage })),
          assets,
          missions,
          tracks,
          occupations,
          offlineReports,
          queue,
          primaryByOverlap,
          offline: state.offline ?? false,
          lowBandwidth: state.lowBandwidth ?? false,
          events: state.events ?? initialEvents
        };
      }
    }
  )
);

/** 派生：协同记录（共享带航迹归主责区，另一区算协同） */
export const selectCoordinations = (state: CommandState) =>
  deriveCoordinations(state.tracks, state.areas, state.occupations, state.primaryByOverlap);
