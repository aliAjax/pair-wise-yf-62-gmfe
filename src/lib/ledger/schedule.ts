import type { Mission, RescueAsset } from '../types';

/** 两个计划时段是否重叠（相接不算重叠） */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

export interface ScheduledMission extends Mission {
  queuedReason?: string;
}

/**
 * 按单位同时段容量重排任务。
 * 任何一个单位在重叠时段占用达到 concurrentCapacity，该任务整体排队；
 * 按 紧急 > 开始时间 > 业务编号 确定性排序；任务关闭/单位变更后自动重算递补。
 */
export function reconcileSchedule(input: {
  missions: Mission[];
  assets: RescueAsset[];
}): ScheduledMission[] {
  const { missions, assets } = input;
  const capacity = new Map(assets.map((a) => [a.id, Math.max(1, a.concurrentCapacity)]));

  const sorted = [...missions].sort((a, b) => {
    if ((a.priority === 'urgent') !== (b.priority === 'urgent')) return a.priority === 'urgent' ? -1 : 1;
    const t = new Date(a.windowStart).getTime() - new Date(b.windowStart).getTime();
    if (t !== 0) return t;
    return a.bizNo.localeCompare(b.bizNo);
  });

  // 每个单位在执行/已派发的占用区间
  const busy = new Map<string, { start: string; end: string; bizNo: string }[]>();
  assets.forEach((a) => busy.set(a.id, []));

  const result = new Map<string, ScheduledMission>();

  for (const mission of sorted) {
    if (mission.status === 'draft' || mission.status === 'closed') {
      result.set(mission.id, mission);
      continue;
    }

    // 原占用：单位一变化就失效，这里按当前 assetIds 重算
    const blockers = mission.assetIds.flatMap((assetId) => {
      const intervals = busy.get(assetId) ?? [];
      const cap = capacity.get(assetId) ?? 1;
      const hits = intervals.filter((iv) => overlaps(mission.windowStart, mission.windowEnd, iv.start, iv.end));
      if (hits.length < cap) return [];
      const asset = assets.find((a) => a.id === assetId);
      return `${asset?.name ?? assetId}（容量${cap}，冲突：${hits.map((h) => h.bizNo).join('、')}）`;
    });

    if (blockers.length) {
      result.set(mission.id, { ...mission, status: 'queued', queuedReason: `超出同时段容量：${blockers.join('；')}` });
    } else {
      for (const assetId of mission.assetIds) {
        busy.get(assetId)?.push({ start: mission.windowStart, end: mission.windowEnd, bizNo: mission.bizNo });
      }
      // 排队任务在容量释放后自动递补为已派发；进行中/已派发保持原状
      const status = mission.status === 'queued' ? 'dispatched' : mission.status;
      result.set(mission.id, { ...mission, status, queuedReason: undefined });
    }
  }

  return missions.map((m) => result.get(m.id) ?? m);
}
