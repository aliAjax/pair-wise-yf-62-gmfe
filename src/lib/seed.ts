import type {
  EventLog,
  MergedTrack,
  Mission,
  RescueAsset,
  SearchArea,
  SharedBelt,
  TrackReport
} from './types';
import { mergeReports } from './ledger/reports';

const iso = (base: number, offsetMin: number) => new Date(base + offsetMin * 60_000).toISOString();

export function buildSeed(now = Date.now()) {
  const areas: SearchArea[] = [
    {
      id: 'area-a',
      name: 'A区 · 最后目击点',
      bounds: [121.42, 30.65, 121.68, 30.88],
      status: 'active',
      rev: 1,
      updatedAt: iso(now, -90),
      legacyCoverage: 68
    },
    {
      id: 'area-b',
      name: 'B区 · 北向漂流',
      bounds: [121.64, 30.82, 121.96, 31.06],
      status: 'active',
      rev: 1,
      updatedAt: iso(now, -80),
      legacyCoverage: 32
    }
  ];

  const belts: SharedBelt[] = [
    {
      id: 'belt:area-a~area-b',
      areaIds: ['area-a', 'area-b'],
      ownerAreaId: 'area-a',
      bounds: [121.64, 30.82, 121.68, 30.88],
      note: '交叠水域先定主责：A区主责，B区协同',
      updatedAt: iso(now, -85)
    }
  ];

  const assets: RescueAsset[] = [
    {
      id: 'ship-01',
      name: '海巡071',
      type: 'ship',
      status: 'assigned',
      lat: 30.75,
      lng: 121.55,
      lastSeen: iso(now, -0.5),
      concurrentCapacity: 1
    },
    {
      id: 'heli-02',
      name: '救助B-712',
      type: 'helicopter',
      status: 'ready',
      lat: 30.82,
      lng: 121.73,
      lastSeen: iso(now, -7),
      concurrentCapacity: 1
    },
    {
      id: 'drone-03',
      name: '无人机D-9',
      type: 'drone',
      status: 'offline',
      lat: 30.69,
      lng: 121.61,
      lastSeen: iso(now, -18),
      concurrentCapacity: 1
    },
    {
      id: 'drone-04',
      name: '无人机D-12',
      type: 'drone',
      status: 'ready',
      lat: 30.9,
      lng: 121.8,
      lastSeen: iso(now, -3),
      concurrentCapacity: 1
    }
  ];

  const missions: Mission[] = [
    {
      id: 'mission-1',
      bizNo: 'SAR-2601',
      title: 'A区扇形搜索',
      areaId: 'area-a',
      // 单位已从 ship+drone 调整为仅 ship：原无人机占用失效（rev=2）
      assetIds: ['ship-01'],
      status: 'in_progress',
      priority: 'urgent',
      note: '优先核验橙色漂浮物；无人机调往B区',
      windowStart: iso(now, -60),
      windowEnd: iso(now, 60),
      rev: 2,
      updatedAt: iso(now, -20)
    },
    {
      id: 'mission-2',
      bizNo: 'SAR-2602',
      title: 'B区扩面复核',
      areaId: 'area-b',
      assetIds: ['ship-01'],
      status: 'dispatched',
      priority: 'normal',
      note: '与SAR-2601同时段，海巡071容量为1 → 排队',
      windowStart: iso(now, -10),
      windowEnd: iso(now, 50),
      rev: 1,
      updatedAt: iso(now, -10)
    },
    {
      id: 'mission-3',
      bizNo: 'SAR-2598',
      title: 'B区东北向巡查（昨）',
      areaId: 'area-b',
      assetIds: ['drone-04'],
      status: 'closed',
      priority: 'normal',
      note: '收队关闭；关闭后收到离线旧报告，只补历史',
      windowStart: iso(now, -60 * 26),
      windowEnd: iso(now, -60 * 24),
      closedAt: iso(now, -60 * 23),
      rev: 1,
      updatedAt: iso(now, -60 * 23)
    },
    {
      id: 'mission-4',
      bizNo: 'SAR-2603',
      title: '交叠带目视核查',
      areaId: 'area-a',
      assetIds: ['heli-02'],
      status: 'dispatched',
      priority: 'normal',
      note: '直升机沿共享带巡查',
      windowStart: iso(now, -30),
      windowEnd: iso(now, 30),
      rev: 1,
      updatedAt: iso(now, -30)
    }
  ];

  // SAR-2601 海巡071：在A区内部跑折线（跨两个记账时段），中间飞偏进B区一侧
  const shipTrackA = [
    { t: iso(now, -55), lng: 121.46, lat: 30.7 },
    { t: iso(now, -48), lng: 121.54, lat: 30.72 },
    { t: iso(now, -40), lng: 121.5, lat: 30.78 },
    { t: iso(now, -32), lng: 121.58, lat: 30.76 },
    // 飞偏：进入B区非共享带水域（对B区算协同）
    { t: iso(now, -24), lng: 121.72, lat: 30.9 },
    { t: iso(now, -16), lng: 121.6, lat: 30.84 },
    // 回到A区，且穿过共享带（带归A区主责）
    { t: iso(now, -8), lng: 121.66, lat: 30.85 },
    { t: iso(now, -2), lng: 121.52, lat: 30.68 }
  ];

  // SAR-2601 无人机D-9 的旧航迹：单位已调整，原占用失效（detached，不进当前覆盖率）
  const droneStaleTrack = [
    { t: iso(now, -50), lng: 121.48, lat: 30.8 },
    { t: iso(now, -42), lng: 121.55, lat: 30.82 },
    { t: iso(now, -34), lng: 121.6, lat: 30.79 }
  ];

  // SAR-2598 D-12 昨日航迹（关闭时已有的一段）
  const droneYesterday = [
    { t: iso(now, -60 * 25.5), lng: 121.82, lat: 30.96 },
    { t: iso(now, -60 * 25), lng: 121.9, lat: 31.0 }
  ];
  // 晚到旧报告：关闭后2小时才回传，只补历史
  const droneLateChunk = [
    { t: iso(now, -60 * 24.5), lng: 121.86, lat: 30.92 },
    { t: iso(now, -60 * 24.2), lng: 121.92, lat: 30.96 }
  ];

  // SAR-2603 直升机：从共享带起飞，一段在带内，一段漏飞（后半窗口无航迹）
  const heliBeltTrack = [
    { t: iso(now, -28), lng: 121.65, lat: 30.83 },
    { t: iso(now, -20), lng: 121.67, lat: 30.87 }
  ];

  const reports: TrackReport[] = [
    // 船艇离线回传分片 1/2
    {
      reportId: 'r-ship-1',
      bizNo: 'SAR-2601',
      assetId: 'ship-01',
      points: shipTrackA.slice(0, 4),
      sentAt: iso(now, -38),
      offline: true,
      chunkIndex: 0,
      chunkTotal: 2
    },
    // 分片 2/2（恢复在线后补传）
    {
      reportId: 'r-ship-2',
      bizNo: 'SAR-2601',
      assetId: 'ship-01',
      points: shipTrackA.slice(4),
      sentAt: iso(now, -6),
      offline: false,
      chunkIndex: 1,
      chunkTotal: 2
    },
    // 同一份报告重传：幂等去重
    {
      reportId: 'r-ship-2',
      bizNo: 'SAR-2601',
      assetId: 'ship-01',
      points: shipTrackA.slice(4),
      sentAt: iso(now, -5),
      offline: false,
      chunkIndex: 1,
      chunkTotal: 2
    },
    // 无人机D-9 旧航迹（单位已不在SAR-2601上）
    {
      reportId: 'r-drone9-1',
      bizNo: 'SAR-2601',
      assetId: 'drone-03',
      points: droneStaleTrack,
      sentAt: iso(now, -30),
      offline: true
    },
    // 昨日任务关闭时的航迹
    {
      reportId: 'r-drone12-1',
      bizNo: 'SAR-2598',
      assetId: 'drone-04',
      points: droneYesterday,
      sentAt: iso(now, -60 * 24),
      offline: false
    },
    // 晚到旧报告：任务已关闭2小时后才到，只补历史
    {
      reportId: 'r-drone12-late',
      bizNo: 'SAR-2598',
      assetId: 'drone-04',
      points: droneLateChunk,
      sentAt: iso(now, -60 * 21),
      offline: true
    },
    // 直升机实时
    {
      reportId: 'r-heli-1',
      bizNo: 'SAR-2603',
      assetId: 'heli-02',
      points: heliBeltTrack,
      sentAt: iso(now, -18),
      offline: false
    }
  ];

  const { tracks } = mergeReports([], reports, new Map(missions.map((m) => [m.bizNo, m])));

  const events: EventLog[] = [
    {
      id: 'event-1',
      time: iso(now, -90),
      actor: '指挥员',
      message: 'A、B搜索区划设完成，交叠水域按规则确定A区主责、B区协同',
      kind: 'plan'
    },
    {
      id: 'event-2',
      time: iso(now, -60),
      actor: '指挥员',
      message: 'SAR-2601 任务单派发，海巡071、无人机D-9执行A区扇形搜索',
      kind: 'plan'
    },
    {
      id: 'event-3',
      time: iso(now, -20),
      actor: '指挥员',
      message: 'SAR-2601 单位调整：D-9撤下、海巡071单独执行，原D-9占用失效，覆盖率重算',
      kind: 'ledger'
    },
    {
      id: 'event-4',
      time: iso(now, -18),
      actor: '无人机D-9',
      message: '链路中断，离线航迹暂存本机，恢复后按业务编号合并',
      kind: 'system'
    },
    {
      id: 'event-5',
      time: iso(now, -10),
      actor: '值班员',
      message: 'SAR-2602 与SAR-2601同时段调派海巡071，超出容量1，任务进入排队',
      kind: 'plan'
    }
  ];

  return { areas, belts, assets, missions, tracks, reports, events };
}

export type SeedData = ReturnType<typeof buildSeed>;

/** store 已消费入 tracks 后，原始报告不再持久化，这里只给类型占位 */
export type { TrackReport, MergedTrack };
