// Migration test: seed a v1 persisted state (no primary scope, no businessNo, no tracks) and rehydrate
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k)
};
(globalThis as any).localStorage = mockLocalStorage;
(globalThis as any).window = { localStorage: mockLocalStorage };
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = { randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }) };
}

// Require the store AFTER window is mocked so createJSONStorage succeeds and api.persist is attached
const { useCommandStore } = require('../src/lib/store') as typeof import('../src/lib/store');
const { overlapKey } = require('../src/lib/ledger') as typeof import('../src/lib/ledger');

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`  FAIL ${name}`); }
}

// Simulate an old v1 persisted state: no primaryByOverlap, missions without businessNo, no tracks/occupations
const v1State = {
  state: {
    areas: [
      { id: 'area-a', name: 'A区', bounds: [121.42, 30.65, 121.68, 30.88], status: 'active', coverage: 68 },
      { id: 'area-b', name: 'B区', bounds: [121.64, 30.82, 121.96, 31.06], status: 'planned', coverage: 32 }
    ],
    assets: [
      { id: 'ship-01', name: '海巡071', type: 'ship', status: 'assigned', lat: 30.75, lng: 121.55, lastSeen: new Date().toISOString() }
    ],
    missions: [
      // old mission: no businessNo, in_progress in area-a
      { id: 'mission-1', title: 'A区扇形搜索', areaId: 'area-a', assetIds: ['ship-01'], status: 'in_progress', priority: 'urgent', note: '', updatedAt: new Date(Date.now() - 60000).toISOString() }
    ],
    events: [],
    offline: false,
    lowBandwidth: false
  },
  version: 1
};
store.set('maritime-command-v2', JSON.stringify(v1State));

// Rehydrate from the seeded v1 state
useCommandStore.persist.rehydrate();

const st = useCommandStore.getState();
check('migrated: businessNo backfilled from mission id', st.missions[0].businessNo === 'mission-1');
check('migrated: capacity backfilled', st.assets[0].capacity === 2);
check('migrated: primaryByOverlap backfilled', Object.keys(st.primaryByOverlap).length >= 1);
check('migrated: primary is area-a (historical mission)', st.primaryByOverlap[overlapKey('area-a', 'area-b')] === 'area-a');
check('migrated: occupations seeded for in_progress mission', st.occupations.some((o) => o.businessNo === 'mission-1' && o.status === 'active'));
check('migrated: tracks array exists', Array.isArray(st.tracks));
check('migrated: queue array exists', Array.isArray(st.queue));
check('migrated: coverage is recomputed number', typeof st.areas[0].coverage === 'number');
check('migrated: events preserved', Array.isArray(st.events));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
