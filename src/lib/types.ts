export type AreaStatus = 'planned' | 'active' | 'closed';
export type AssetStatus = 'ready' | 'assigned' | 'offline' | 'returning';
export type MissionStatus = 'draft' | 'dispatched' | 'queued' | 'in_progress' | 'closed';
export type Priority = 'normal' | 'urgent';

/** [minLng, minLat, maxLng, maxLat] */
export type Bounds4 = [number, number, number, number];

export interface SearchArea {
  id: string;
  name: string;
  bounds: Bounds4;
  status: AreaStatus;
  /** 边界或主责关系每变更一次 +1，覆盖率按最新版本重算 */
  rev: number;
  updatedAt: string;
  /** v1 静态覆盖率，仅迁移留档，不再作为账面数字 */
  legacyCoverage?: number;
}

export interface RescueAsset {
  id: string;
  name: string;
  type: 'ship' | 'helicopter' | 'drone' | 'shore';
  status: AssetStatus;
  lat: number;
  lng: number;
  lastSeen: string;
  /** 同一时段可并行承担的任务数（同时段容量） */
  concurrentCapacity: number;
}

export interface Mission {
  id: string;
  /** 业务编号，离线回传按它对账合并 */
  bizNo: string;
  title: string;
  areaId: string;
  assetIds: string[];
  status: MissionStatus;
  priority: Priority;
  note: string;
  /** 计划搜索时段，容量排队按它判重叠 */
  windowStart: string;
  windowEnd: string;
  closedAt?: string;
  /** 单位或搜索区每变更一次 +1，原占用失效 */
  rev: number;
  updatedAt: string;
  /** 排队原因（容量不足时由对账引擎写入） */
  queuedReason?: string;
}

/** 交叠水域：先定主责区，带内航迹归主责、另一区算协同 */
export interface SharedBelt {
  id: string;
  areaIds: [string, string];
  ownerAreaId: string;
  bounds: Bounds4;
  note?: string;
  /** 升级时按历史任务边界回填而来 */
  backfilled?: boolean;
  updatedAt: string;
}

export interface TrackPoint {
  t: string;
  lng: number;
  lat: number;
}

/** 船艇/无人机回传的一份航迹报告（可能离线、可能分片） */
export interface TrackReport {
  reportId: string;
  bizNo: string;
  assetId: string;
  points: TrackPoint[];
  /** 回传时刻（晚到判定用） */
  sentAt: string;
  offline: boolean;
  chunkIndex?: number;
  chunkTotal?: number;
}

export type LedgerSource = 'live' | 'offline-merge' | 'late-backfill';

/** 按业务编号 + 单位合并后的航迹 */
export interface MergedTrack {
  bizNo: string;
  assetId: string;
  reportIds: string[];
  offline: boolean;
  points: TrackPoint[];
  /** 晚到补记点（任务关闭后才回传），key 与 points 同源 */
  latePointKeys: string[];
  receivedAt: string;
}

export interface EventLog {
  id: string;
  time: string;
  actor: string;
  message: string;
  kind?: 'plan' | 'track' | 'ledger' | 'system';
}

/** 一条责任账：某单位某一时段，对唯一主责区的实际航迹记账 */
export interface LedgerRow {
  key: string;
  bizNo: string;
  missionId: string;
  assetId: string;
  slotStart: string;
  slotEnd: string;
  /** 该槽唯一计入主责的搜索区 */
  ownerAreaId: string;
  /** 主责航迹格（归主责区） */
  primaryCells: string[];
  /** 其中由晚到旧报告补记的格（只补历史） */
  latePrimaryCells: string[];
  /** 协同：其他区id -> 落在该区、算协同的航迹格 */
  cooperationCells: Record<string, string[]>;
  /** 落在交叠带但尚未定主责的格 */
  unownedCells: string[];
  /** 区外漂移格数（飞偏） */
  outsideCells: number;
  /** 该槽有航迹但任务已不再挂该单位（单位变化导致原占用失效） */
  detached: boolean;
  source: LedgerSource;
}

export interface AreaStat {
  areaId: string;
  totalCells: number;
  primaryCells: number;
  cooperationCells: number;
  primaryPercent: number;
  cooperationPercent: number;
  /** 含晚到补历史在内的主责覆盖率 */
  primaryPercentWithLate: number;
  revised: boolean;
}

export interface GapSlot {
  bizNo: string;
  assetId: string;
  slotStart: string;
  slotEnd: string;
}
