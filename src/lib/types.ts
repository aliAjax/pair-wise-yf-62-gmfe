export type AreaStatus = 'planned' | 'active' | 'closed';
export type AssetStatus = 'ready' | 'assigned' | 'offline' | 'returning';
export type MissionStatus = 'draft' | 'dispatched' | 'in_progress' | 'closed';

/** 西南角 + 东北角边界：[西经, 南纬, 东经, 北纬] */
export type Bounds = [number, number, number, number];

export interface SearchArea {
  id: string;
  name: string;
  bounds: Bounds;
  status: AreaStatus;
  /** 按实际航迹重算后的覆盖率（0-100） */
  coverage: number;
}

export type AssetType = 'ship' | 'helicopter' | 'drone' | 'shore';

export interface RescueAsset {
  id: string;
  name: string;
  type: AssetType;
  status: AssetStatus;
  lat: number;
  lng: number;
  lastSeen: string;
  /** 同时段可承担的任务数；超出则任务排队 */
  capacity: number;
}

export interface Mission {
  id: string;
  /** 业务编号：离线回传合并的依据 */
  businessNo: string;
  title: string;
  areaId: string;
  assetIds: string[];
  status: MissionStatus;
  priority: 'normal' | 'urgent';
  note: string;
  updatedAt: string;
}

/** 航迹点：单位实际回传的位置 */
export interface TrackPoint {
  id: string;
  /** 关联任务单业务编号 */
  businessNo: string;
  assetId: string;
  lat: number;
  lng: number;
  time: string;
  /** 在线回传 / 离线合并 */
  source: 'online' | 'offline';
  /** 晚到的旧报告：只补历史，不计覆盖率 */
  late: boolean;
  /** 是否已合并入台账 */
  merged: boolean;
}

/** 占用：单位在某时段对某搜索区的责任 */
export interface Occupation {
  id: string;
  assetId: string;
  areaId: string;
  businessNo: string;
  start: string;
  end?: string;
  status: 'active' | 'invalid' | 'closed';
  /** 失效原因，如单位/搜索区变化 */
  reason?: string;
}

/** 协同记录：共享带航迹归主责区，另一区算协同 */
export interface Coordination {
  id: string;
  /** 协同区（非主责） */
  areaId: string;
  /** 主责区 */
  primaryAreaId: string;
  assetId: string;
  businessNo: string;
  pointIds: string[];
  time: string;
}

/** 离线回传报告：按业务编号合并 */
export interface OfflineReport {
  id: string;
  businessNo: string;
  assetId: string;
  points: Array<{ lat: number; lng: number; time: string }>;
  receivedAt: string;
  merged: boolean;
  /** 晚到报告：只补历史 */
  late: boolean;
}

/** 容量队列条目 */
export interface QueueEntry {
  id: string;
  businessNo: string;
  missionId: string;
  assetId: string;
  areaId: string;
  reason: 'capacity';
  queuedAt: string;
}

/** 交叠水域的主责范围 */
export interface ResponsibilityScope {
  /** key = 重叠区 pair key（两个 areaId 排序后 join '|'），value = 主责区 id */
  primaryByOverlap: Record<string, string>;
}

export interface EventLog {
  id: string;
  time: string;
  actor: string;
  message: string;
}
