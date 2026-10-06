'use client';

import { useMemo } from 'react';
import { useCommandStore } from './store';
import { buildLedger, type LedgerResult } from './ledger/ledger';
import { reconcileSchedule } from './ledger/schedule';

/** 责任账 + 容量排队的统一派生视图：区/带/单位/任务/航迹任一变化都重算 */
export function useLedger(): LedgerResult & {
  scheduled: ReturnType<typeof reconcileSchedule>;
  tracks: ReturnType<typeof useCommandStore.getState>['tracks'];
} {
  const areas = useCommandStore((s) => s.areas);
  const belts = useCommandStore((s) => s.belts);
  const assets = useCommandStore((s) => s.assets);
  const missions = useCommandStore((s) => s.missions);
  const tracks = useCommandStore((s) => s.tracks);

  return useMemo(() => {
    const scheduled = reconcileSchedule({ missions, assets });
    const ledger = buildLedger({ missions, areas, belts, tracks });
    return { ...ledger, scheduled, tracks };
  }, [areas, belts, assets, missions, tracks]);
}
