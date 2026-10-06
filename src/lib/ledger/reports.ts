import type { MergedTrack, Mission, TrackPoint, TrackReport } from '../types';

export function pointKey(p: TrackPoint): string {
  return `${p.t}|${p.lng.toFixed(6)}|${p.lat.toFixed(6)}`;
}

/**
 * 离线回传按业务编号 + 执行单位合并。
 * - reportId 幂等：同一份报告重传不重复入账；
 * - 分片（chunkIndex/chunkTotal）归并到同一业务编号；
 * - 航迹点按时间排序、去重（同时间同坐标）；
 * - 晚到旧报告（任务关闭后到达）：点保留并记入 latePointKeys，只补历史，
 *   不改变任何在执行任务的占用与排队。
 */
export interface IngestResult {
  tracks: MergedTrack[];
  ingested: {
    report: TrackReport;
    duplicate: boolean;
    late: boolean;
    mergedKey: string;
  }[];
}

interface Group {
  bizNo: string;
  assetId: string;
  reportIds: string[];
  reportSet: Set<string>;
  offline: boolean;
  points: TrackPoint[];
  latePointKeys: Set<string>;
  receivedAt: string;
}

export function mergeReports(
  previous: MergedTrack[],
  reports: TrackReport[],
  missionsByBiz: Map<string, Mission>
): IngestResult {
  const groups = new Map<string, Group>();
  const ingested: IngestResult['ingested'] = [];

  for (const track of previous) {
    groups.set(`${track.bizNo}|${track.assetId}`, {
      bizNo: track.bizNo,
      assetId: track.assetId,
      reportIds: [...track.reportIds],
      reportSet: new Set(track.reportIds),
      offline: track.offline,
      points: [...track.points],
      latePointKeys: new Set(track.latePointKeys),
      receivedAt: track.receivedAt
    });
  }

  // 报告按 sentAt 顺序入账：先到先得，晚到的只补历史
  const ordered = [...reports].sort(
    (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
  );

  for (const report of ordered) {
    const key = `${report.bizNo}|${report.assetId}`;
    const mission = missionsByBiz.get(report.bizNo);
    const late =
      !!mission?.closedAt &&
      new Date(report.sentAt).getTime() > new Date(mission.closedAt).getTime();

    let group = groups.get(key);
    if (!group) {
      group = {
        bizNo: report.bizNo,
        assetId: report.assetId,
        reportIds: [],
        reportSet: new Set(),
        offline: false,
        points: [],
        latePointKeys: new Set(),
        receivedAt: report.sentAt
      };
      groups.set(key, group);
    }

    if (group.reportSet.has(report.reportId)) {
      ingested.push({ report, duplicate: true, late, mergedKey: key });
      continue;
    }
    group.reportSet.add(report.reportId);
    group.reportIds.push(report.reportId);
    group.offline = group.offline || report.offline;
    for (const p of report.points) {
      const pk = pointKey(p);
      if (!group.points.some((q) => pointKey(q) === pk)) group.points.push(p);
      if (late) group.latePointKeys.add(pk);
    }
    ingested.push({ report, duplicate: false, late, mergedKey: key });
  }

  const tracks: MergedTrack[] = [...groups.values()]
    .map((g) => ({
      bizNo: g.bizNo,
      assetId: g.assetId,
      reportIds: g.reportIds,
      offline: g.offline,
      points: [...g.points].sort(
        (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime()
      ),
      latePointKeys: [...g.latePointKeys].sort(),
      receivedAt: g.receivedAt
    }))
    .sort((a, b) => a.bizNo.localeCompare(b.bizNo) || a.assetId.localeCompare(b.assetId));

  return { tracks, ingested };
}
