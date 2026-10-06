'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AreaStatus,
  AssetStatus,
  Bounds4,
  EventLog,
  MergedTrack,
  Mission,
  MissionStatus,
  Priority,
  RescueAsset,
  SearchArea,
  SharedBelt,
  TrackReport
} from './types';
import { buildSeed } from './seed';
import { backfillBeltOwners, discoverBelts } from './ledger/belts';
import { mergeReports } from './ledger/reports';
import { reconcileSchedule } from './ledger/schedule';

interface PersistedState {
  areas: SearchArea[];
  belts: SharedBelt[];
  assets: RescueAsset[];
  missions: Mission[];
  tracks: MergedTrack[];
  reports: TrackReport[];
  events: EventLog[];
  offline: boolean;
  lowBandwidth: boolean;
  seq: number;
}

interface CommandState extends PersistedState {
  setAreaStatus: (id: string, status: AreaStatus) => void;
  setAssetStatus: (id: string, status: AssetStatus) => void;
  setCapacity: (id: string, capacity: number) => void;
  setMissionStatus: (id: string, status: MissionStatus) => void;
  /** 任务单单位或搜索区变化：原占用失效，覆盖率与队列重算 */
  reviseMission: (id: string, patch: { areaId?: string; assetIds?: string[] }) => void;
  /** 搜索区边界变化：rev+1，覆盖率按新边界重算，交叠带重新发现 */
  reviseAreaBounds: (id: string, bounds: Bounds4) => void;
  /** 交叠水域定主责 */
  assignBeltOwner: (beltId: string, ownerAreaId: string) => void;
  dispatchMission: (input: {
    title: string;
    areaId: string;
    assetIds: string[];
    priority: Priority;
    note: string;
    windowStart: string;
    windowEnd: string;
  }) => void;
  /** 回传航迹（在线/离线均可）：按业务编号合并，重传幂等，晚到只补历史 */
  ingestReports: (reports: TrackReport[]) => void;
  rerunSchedule: () => void;
  toggleOffline: () => void;
  toggleBandwidth: () => void;
  resetDemo: () => void;
}

const seed = buildSeed();

function nextBizNo(seq: number): string {
  return `SAR-${2600 + seq}`;
}

function log(events: EventLog[], actor: string, message: string, kind: EventLog['kind'] = 'plan'): EventLog[] {
  return [
    { id: crypto.randomUUID(), time: new Date().toISOString(), actor, message, kind },
    ...events
  ];
}

/** 容量排队只改任务状态字段，不动其余字段 */
function withSchedule(
  missions: Mission[],
  assets: RescueAsset[],
  events: EventLog[]
): { missions: Mission[]; events: EventLog[] } {
  const before = new Map(missions.map((m) => [m.id, m.status]));
  const scheduled = reconcileSchedule({ missions, assets });
  let next = events;
  for (const m of scheduled) {
    if (before.get(m.id) !== m.status) {
      next = log(
        next,
        '对账引擎',
        m.status === 'queued'
          ? `${m.bizNo} 超出单位同时段容量，进入排队${m.queuedReason ? `：${m.queuedReason}` : ''}`
          : `容量释放，${m.bizNo} 自动递补为${m.status === 'in_progress' ? '执行中' : '已派发'}`,
        'ledger'
      );
    }
  }
  return { missions: scheduled, events: next };
}

export const useCommandStore = create<CommandState>()(
  persist<CommandState, [], [], PersistedState>(
    (set) => ({
      ...seed,
      offline: false,
      lowBandwidth: false,
      seq: 4,

      setAreaStatus: (id, status) =>
        set((s) => ({
          areas: s.areas.map((a) => (a.id === id ? { ...a, status } : a)),
          events: log(s.events, '指挥员', `搜索区 ${id} 状态改为 ${status}`)
        })),

      setAssetStatus: (id, status) =>
        set((s) => ({
          assets: s.assets.map((a) =>
            a.id === id ? { ...a, status, lastSeen: new Date().toISOString() } : a
          ),
          events: log(s.events, '值班员', `${s.assets.find((a) => a.id === id)?.name ?? id} 状态改为 ${status}`)
        })),

      setCapacity: (id, capacity) =>
        set((s) => {
          const assets = s.assets.map((a) =>
            a.id === id ? { ...a, concurrentCapacity: Math.max(1, capacity) } : a
          );
          const r = withSchedule(s.missions, assets, s.events);
          return {
            assets,
            missions: r.missions,
            events: log(r.events, '指挥员', `${assets.find((a) => a.id === id)?.name ?? id} 同时段容量调整为 ${Math.max(1, capacity)}，任务占用重算`, 'ledger')
          };
        }),

      setMissionStatus: (id, status) =>
        set((s) => {
          const mission = s.missions.find((m) => m.id === id);
          if (!mission) return s;
          const missions = s.missions.map((m) =>
            m.id === id
              ? {
                  ...m,
                  status,
                  closedAt: status === 'closed' ? new Date().toISOString() : m.closedAt,
                  updatedAt: new Date().toISOString()
                }
              : m
          );
          let events = log(
            s.events,
            '指挥员',
            `${mission.bizNo} 状态改为 ${status}${status === 'closed' ? '，晚到旧报告将只补历史' : ''}`,
            'ledger'
          );
          const r = withSchedule(missions, s.assets, events);
          return { missions: r.missions, events: r.events };
        }),

      reviseMission: (id, patch) =>
        set((s) => {
          const mission = s.missions.find((m) => m.id === id);
          if (!mission) return s;
          const missions = s.missions.map((m) =>
            m.id === id
              ? {
                  ...m,
                  areaId: patch.areaId ?? m.areaId,
                  assetIds: patch.assetIds ?? m.assetIds,
                  rev: m.rev + 1,
                  queuedReason: undefined,
                  updatedAt: new Date().toISOString()
                }
              : m
          );
          const changes = [
            patch.areaId && patch.areaId !== mission.areaId ? `搜索区改为 ${patch.areaId}` : '',
            patch.assetIds && JSON.stringify([...patch.assetIds].sort()) !== JSON.stringify([...mission.assetIds].sort())
              ? `单位改为 ${patch.assetIds.join('、')}`
              : ''
          ].filter(Boolean);
          let events = log(
            s.events,
            '指挥员',
            `${mission.bizNo} ${changes.join('，')}；原占用失效，覆盖率按实际航迹重算`,
            'ledger'
          );
          const r = withSchedule(missions, s.assets, events);
          return { missions: r.missions, events: r.events };
        }),

      reviseAreaBounds: (id, bounds) =>
        set((s) => {
          const areas = s.areas.map((a) =>
            a.id === id ? { ...a, bounds, rev: a.rev + 1, updatedAt: new Date().toISOString() } : a
          );
          // 交叠带随边界重新发现，已划定的主责保留
          const belts = discoverBelts(areas, s.belts);
          return {
            areas,
            belts,
            events: log(
              s.events,
              '指挥员',
              `搜索区 ${id} 边界调整，版本号+1，原覆盖率按实际航迹重算，交叠带重新核定`,
              'ledger'
            )
          };
        }),

      assignBeltOwner: (beltId, ownerAreaId) =>
        set((s) => ({
          belts: s.belts.map((b) =>
            b.id === beltId
              ? { ...b, ownerAreaId, note: b.backfilled ? b.note : '交叠水域主责由指挥员指定', updatedAt: new Date().toISOString() }
              : b
          ),
          events: log(
            s.events,
            '指挥员',
            `交叠带 ${beltId} 主责区定为 ${ownerAreaId}，另一区航迹计协同，覆盖率重算`,
            'ledger'
          )
        })),

      dispatchMission: (input) =>
        set((s) => {
          const seq = s.seq + 1;
          const mission: Mission = {
            id: crypto.randomUUID(),
            bizNo: nextBizNo(seq),
            title: input.title,
            areaId: input.areaId,
            assetIds: input.assetIds,
            status: 'dispatched',
            priority: input.priority,
            note: input.note,
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
            rev: 1,
            updatedAt: new Date().toISOString()
          };
          let events = log(s.events, '指挥员', `任务单 ${mission.bizNo}「${input.title}」已派发，待按实际航迹记账`);
          const r = withSchedule([mission, ...s.missions], s.assets, events);
          return { missions: r.missions, events: r.events, seq };
        }),

      ingestReports: (incoming) =>
        set((s) => {
          const missionsByBiz = new Map(s.missions.map((m) => [m.bizNo, m]));
          const { tracks, ingested } = mergeReports(s.tracks, incoming, missionsByBiz);
          const fresh = ingested.filter((i) => !i.duplicate);
          let events = s.events;
          for (const i of fresh) {
            events = log(
              events,
              s.assets.find((a) => a.id === i.report.assetId)?.name ?? i.report.assetId,
              i.late
                ? `${i.report.bizNo} 晚到旧报告已按业务编号合并，仅补历史（任务已关闭）`
                : `${i.report.bizNo} 航迹已按业务编号合并${i.report.offline ? '（离线回传）' : ''}，责任账重算`,
              i.late ? 'ledger' : 'track'
            );
          }
          if (ingested.some((i) => i.duplicate)) {
            events = log(events, '对账引擎', `${ingested.filter((i) => i.duplicate).length} 份重复报告幂等去重，未重复记账`, 'ledger');
          }
          // 原始报告仅作归档；责任账以合并后的 tracks 为准
          const reportKey = (r: TrackReport) => `${r.reportId}:${r.chunkIndex ?? 0}`;
          const seen = new Set(s.reports.map(reportKey));
          const reports = [...s.reports, ...incoming.filter((r) => !seen.has(reportKey(r)))];
          return { tracks, reports, events };
        }),

      rerunSchedule: () =>
        set((s) => {
          const r = withSchedule(s.missions, s.assets, s.events);
          return { missions: r.missions, events: r.events };
        }),

      toggleOffline: () => set((s) => ({ offline: !s.offline })),
      toggleBandwidth: () => set((s) => ({ lowBandwidth: !s.lowBandwidth })),

      resetDemo: () => {
        const fresh = buildSeed();
        set({ ...fresh, seq: 4 });
      }
    }),
    {
      name: 'maritime-command-v2',
      version: 2,
      // 旧数据没有主责范围：v1→v2 升级时按历史任务边界回填交叠带主责
      migrate: (persisted: unknown, version: number) => {
        type V1Area = SearchArea & { coverage?: number };
        const v1 = persisted as Omit<Partial<PersistedState>, 'areas'> & {
          areas?: V1Area[];
        };
        if (version < 2) {
          const now = new Date().toISOString();
          const areas: SearchArea[] = (v1.areas ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            bounds: a.bounds,
            status: a.status,
            rev: 1,
            updatedAt: a.updatedAt ?? now,
            legacyCoverage: typeof a.coverage === 'number' ? a.coverage : undefined
          }));
          const assets: RescueAsset[] = (v1.assets ?? []).map((a) => ({
            ...a,
            concurrentCapacity: a.type === 'ship' ? 2 : 1
          }));
          const missions: Mission[] = ((v1.missions ?? []) as Array<Partial<Mission> & { id: string; updatedAt: string }>).map((m) => ({
            id: m.id,
            title: m.title ?? '历史任务',
            areaId: m.areaId ?? '',
            assetIds: m.assetIds ?? [],
            status: m.status ?? 'closed',
            priority: m.priority ?? 'normal',
            note: m.note ?? '',
            bizNo: m.bizNo ?? `LEGACY-${m.id.slice(-4)}`.toUpperCase(),
            windowStart: m.windowStart ?? m.updatedAt,
            windowEnd: m.windowEnd ?? new Date(new Date(m.updatedAt).getTime() + 2 * 3600_000).toISOString(),
            closedAt: m.closedAt,
            rev: 1,
            updatedAt: m.updatedAt
          }));
          const rawBelts = discoverBelts(areas, []);
          const { belts, unresolved } = backfillBeltOwners(areas, rawBelts, missions);
          return {
            areas,
            assets,
            missions,
            belts,
            tracks: [],
            reports: [],
            events: [
              {
                id: crypto.randomUUID(),
                time: now,
                actor: '系统升级',
                message: `旧数据升级：按历史任务边界回填 ${belts.filter((b) => b.backfilled).length} 条交叠带主责${
                  unresolved.length ? `，${unresolved.length} 处交叠无历史依据，待指挥员指定` : ''
                }`,
                kind: 'system'
              },
              ...(v1.events ?? [])
            ],
            offline: false,
            lowBandwidth: false,
            seq: missions.length
          } as PersistedState;
        }
        return persisted as PersistedState;
      },
      merge: (persisted: unknown, current: CommandState): CommandState => {
        const p = persisted as Partial<PersistedState> | undefined;
        if (!p) return current;
        // 兜底：任何缺 belts/rev 的状态（未走 migrate）都补算一次
        const areas = (p.areas ?? current.areas).map((a) => ({ ...a, rev: a.rev ?? 1 }));
        const belts = p.belts?.length
          ? p.belts
          : backfillBeltOwners(areas, discoverBelts(areas, []), p.missions ?? []).belts;
        const merged: PersistedState = {
          areas,
          belts,
          assets: p.assets ?? current.assets,
          missions: p.missions ?? current.missions,
          tracks: p.tracks ?? current.tracks,
          reports: p.reports ?? current.reports,
          events: p.events ?? current.events,
          offline: p.offline ?? current.offline,
          lowBandwidth: p.lowBandwidth ?? current.lowBandwidth,
          seq: p.seq ?? current.seq
        };
        return { ...current, ...merged };
      }
    }
  )
);
