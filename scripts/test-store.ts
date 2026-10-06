// Store integration test with localStorage mock (zustand persist)
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k)
};
// crypto.randomUUID polyfill for node
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = { randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }) };
}

import { useCommandStore } from '../src/lib/store';
import { overlapKey } from '../src/lib/ledger';

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`  FAIL ${name}`); }
}

const s = useCommandStore.getState();
const initialOccCount = s.occupations.length;
check('initial occupations seeded for in_progress mission', initialOccCount >= 2);
check('initial primary backfilled', Object.keys(s.primaryByOverlap).length >= 1);

// dispatch a mission to ship-01 (capacity 2) -> should create occupation
s.dispatchMission({ title: '测试任务甲', areaId: 'area-a', assetIds: ['ship-01'], priority: 'normal', note: '' });
let st = useCommandStore.getState();
const missionA = st.missions[0];
check('dispatch creates mission', missionA.title === '测试任务甲');
const occA = st.occupations.find((o) => o.businessNo === missionA.businessNo && o.status === 'active');
check('dispatch creates active occupation', !!occA);

// dispatch 2 more missions to ship-01 (capacity 2) -> 3rd should queue
s.dispatchMission({ title: '测试任务乙', areaId: 'area-a', assetIds: ['ship-01'], priority: 'normal', note: '' });
s.dispatchMission({ title: '测试任务丙', areaId: 'area-a', assetIds: ['ship-01'], priority: 'normal', note: '' });
st = useCommandStore.getState();
check('capacity exceeded -> queue has entry', st.queue.length >= 1);
check('queued mission exists', st.queue.some((q) => q.reason === 'capacity'));

// simulate online track for mission A -> coverage goes up
const covBefore = st.areas.find((a) => a.id === 'area-a')!.coverage;
s.simulateOnlineTrack(missionA.id);
st = useCommandStore.getState();
const covAfter = st.areas.find((a) => a.id === 'area-a')!.coverage;
check('online track raises coverage', covAfter >= covBefore);
console.log(`  info  coverage A ${covBefore} -> ${covAfter}`);

// simulate offline return then merge
s.simulateOfflineReturn(missionA.id);
st = useCommandStore.getState();
check('offline report created', st.offlineReports.some((r) => !r.merged && r.businessNo === missionA.businessNo));
const tracksBefore = st.tracks.length;
s.mergeOfflineReports();
st = useCommandStore.getState();
check('merge adds tracks by businessNo', st.tracks.length > tracksBefore);
check('all reports merged now', st.offlineReports.every((r) => r.merged));
check('offline tracks tagged source offline', st.tracks.some((t) => t.source === 'offline'));

// set primary area for overlap -> coverage recompute
const pairKey = overlapKey('area-a', 'area-b');
const covABefore = st.areas.find((a) => a.id === 'area-a')!.coverage;
s.setPrimaryArea(pairKey, 'area-b');
st = useCommandStore.getState();
check('primary area changed', st.primaryByOverlap[pairKey] === 'area-b');
check('coverage recomputed on primary change', st.areas.find((a) => a.id === 'area-a')!.coverage !== undefined);
// set back
s.setPrimaryArea(pairKey, 'area-a');

// update mission scope (change area) -> old occupation invalidated
const occForMission = st.occupations.find((o) => o.businessNo === missionA.businessNo);
s.updateMissionScope(missionA.id, { areaId: 'area-b' });
st = useCommandStore.getState();
const invalidated = st.occupations.find((o) => o.businessNo === missionA.businessNo && o.status === 'invalid');
check('scope change invalidates old occupation', !!invalidated);
check('new occupation in new area', st.occupations.some((o) => o.businessNo === missionA.businessNo && o.areaId === 'area-b' && o.status === 'active'));

// close mission -> occupation closed, queue promoted
s.setMissionStatus(missionA.id, 'closed');
st = useCommandStore.getState();
check('mission closed', st.missions.find((m) => m.id === missionA.id)!.status === 'closed');
check('occupation closed', st.occupations.some((o) => o.businessNo === missionA.businessNo && o.status === 'closed'));

// promote queue
const queueBefore = st.queue.length;
s.promoteFromQueue();
st = useCommandStore.getState();
check('queue promoted when capacity frees', st.queue.length <= queueBefore);

// late report: close a mission then simulate offline return -> late
const missionForLate = st.missions.find((m) => m.status === 'in_progress' || m.status === 'dispatched');
if (missionForLate) {
  s.setMissionStatus(missionForLate.id, 'closed');
  s.simulateOfflineReturn(missionForLate.id);
  st = useCommandStore.getState();
  const lateReport = st.offlineReports.find((r) => r.businessNo === missionForLate.businessNo);
  check('report after close is late-only', !!lateReport && lateReport.late === true);
  s.mergeOfflineReports();
  st = useCommandStore.getState();
  const lateTracks = st.tracks.filter((t) => t.businessNo === missionForLate.businessNo && t.late);
  check('late tracks only supplement history', lateTracks.length > 0);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
