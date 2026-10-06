import type { Bounds4, Mission, SearchArea, SharedBelt } from '../types';
import { intersection } from './geometry';

export function beltId(a: string, b: string): string {
  return `belt:${[a, b].sort().join('~')}`;
}

/**
 * 从搜索区两两交叠中找出重叠水域。交叠区必须先定主责（ownerAreaId）。
 * 已有同名带保留主责与回填标记，不覆盖指挥员的裁定。
 */
export function discoverBelts(areas: SearchArea[], existing: SharedBelt[]): SharedBelt[] {
  const belts: SharedBelt[] = [];
  const existingById = new Map(existing.map((b) => [b.id, b]));
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i];
      const b = areas[j];
      const overlap = intersection(a.bounds, b.bounds);
      if (!overlap || isEmptyBox(overlap)) continue;
      const id = beltId(a.id, b.id);
      const prev = existingById.get(id);
      belts.push({
        id,
        areaIds: [a.id, b.id],
        ownerAreaId: prev?.ownerAreaId ?? '',
        bounds: overlap,
        note: prev?.note,
        backfilled: prev?.backfilled,
        updatedAt: prev?.updatedAt ?? new Date().toISOString()
      });
    }
  }
  return belts;
}

function isEmptyBox(b: Bounds4): boolean {
  return b[2] - b[0] <= 0.0001 || b[3] - b[1] <= 0.0001;
}

/**
 * 旧数据没有主责范围：升级时按历史任务边界回填。
 * 谁最早在交叠两侧执行过任务，就把该侧定为带主责；两侧都有则取更早的一方。
 * 返回新的共享带（带 backfilled 标记）与未找到历史依据的交叠。
 */
export function backfillBeltOwners(
  areas: SearchArea[],
  belts: SharedBelt[],
  missions: Mission[]
): { belts: SharedBelt[]; unresolved: SharedBelt[] } {
  const firstMissionByArea = new Map<string, number>();
  for (const mission of missions) {
    const t = new Date(mission.windowStart).getTime();
    const prev = firstMissionByArea.get(mission.areaId);
    if (prev === undefined || t < prev) firstMissionByArea.set(mission.areaId, t);
  }

  const out = belts.map((belt) => {
    if (belt.ownerAreaId) return belt;
    const [a, b] = belt.areaIds;
    const ta = firstMissionByArea.get(a);
    const tb = firstMissionByArea.get(b);
    if (ta === undefined && tb === undefined) return belt;
    let owner = '';
    if (ta !== undefined && tb !== undefined) owner = ta <= tb ? a : b;
    else owner = ta !== undefined ? a : b;
    return {
      ...belt,
      ownerAreaId: owner,
      backfilled: true,
      note: '升级时按历史任务边界回填',
      updatedAt: new Date().toISOString()
    };
  });

  return { belts: out, unresolved: out.filter((b) => !b.ownerAreaId) };
}
