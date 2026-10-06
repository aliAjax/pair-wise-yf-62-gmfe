import {
  backfillPrimary,
  boundsIntersection,
  buildSearchPath,
  deriveCoordinations,
  findOverlaps,
  overlapKey,
  pointCountsForArea,
  pointInBounds,
  primaryAreaAtPoint,
  recomputeCoverage
} from '../src/lib/ledger';
import type { Mission, Occupation, SearchArea, TrackPoint } from '../src/lib/types';

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`  FAIL ${name}`); }
}

const areaA: SearchArea = { id: 'a', name: 'A', bounds: [121.4, 30.6, 121.7, 30.9], status: 'active', coverage: 0 };
const areaB: SearchArea = { id: 'b', name: 'B', bounds: [121.6, 30.8, 121.9, 31.1], status: 'active', coverage: 0 };
const areas = [areaA, areaB];

// overlap
const inter = boundsIntersection(areaA.bounds, areaB.bounds);
check('overlap exists', inter !== null);
check('overlap key order-independent', overlapKey('a', 'b') === overlapKey('b', 'a'));
check('findOverlaps returns one pair', findOverlaps(areas).length === 1);

// primary
const primary = { [overlapKey('a', 'b')]: 'a' };
const inA = primaryAreaAtPoint({ lat: 30.65, lng: 121.45 }, areas, primary);
check('point only in A -> A', inA.area?.id === 'a' && !inA.overlapped);
const inOverlap = primaryAreaAtPoint({ lat: 30.85, lng: 121.65 }, areas, primary);
check('point in overlap -> primary A', inOverlap.area?.id === 'a' && inOverlap.overlapped && inOverlap.otherAreas.length === 1);
const inB = primaryAreaAtPoint({ lat: 31.05, lng: 121.85 }, areas, primary);
check('point only in B -> B', inB.area?.id === 'b');
const outside = primaryAreaAtPoint({ lat: 30.0, lng: 121.0 }, areas, primary);
check('point outside -> null', outside.area === null);

// occupations
const occA: Occupation = { id: 'o1', assetId: 's1', areaId: 'a', businessNo: 'biz-1', start: '2026-10-06T00:00:00Z', status: 'active' };
const occB: Occupation = { id: 'o2', assetId: 's1', areaId: 'b', businessNo: 'biz-2', start: '2026-10-06T00:00:00Z', status: 'active' };
const trackInA: TrackPoint = { id: 't1', businessNo: 'biz-1', assetId: 's1', lat: 30.65, lng: 121.45, time: '2026-10-06T00:10:00Z', source: 'online', late: false, merged: true };
check('track counts for A with occupation', pointCountsForArea(trackInA, areaA, areas, [occA], primary));
check('track does not count for B', !pointCountsForArea(trackInA, areaB, areas, [occA], primary));
check('track in A does not count for B even with B occ', !pointCountsForArea(trackInA, areaB, areas, [occA, occB], primary));

// overlap point counts for primary only
const trackOverlap: TrackPoint = { id: 't2', businessNo: 'biz-1', assetId: 's1', lat: 30.85, lng: 121.65, time: '2026-10-06T00:10:00Z', source: 'online', late: false, merged: true };
check('overlap track counts for primary A', pointCountsForArea(trackOverlap, areaA, areas, [occA], primary));
check('overlap track does not count for B (coordination)', !pointCountsForArea(trackOverlap, areaB, areas, [occA], primary));

// late report does not count
const lateTrack: TrackPoint = { ...trackInA, id: 't3', late: true };
check('late track does not count', !pointCountsForArea(lateTrack, areaA, areas, [occA], primary));

// unmerged offline does not count
const unmerged: TrackPoint = { ...trackInA, id: 't4', merged: false, source: 'offline' };
check('unmerged track does not count', !pointCountsForArea(unmerged, areaA, areas, [occA], primary));

// coverage: path covering A
const pathA = buildSearchPath(areaA, 60);
const tracksA: TrackPoint[] = pathA.map((p, i) => ({ id: `p${i}`, businessNo: 'biz-1', assetId: 's1', lat: p.lat, lng: p.lng, time: `2026-10-06T00:${String(i).padStart(2, '0')}:00Z`, source: 'online', late: false, merged: true }));
const cov = recomputeCoverage(areas, tracksA, [occA], primary);
check('A coverage > 0 with path', cov.a > 0);
check('B coverage 0 (no tracks)', cov.b === 0);
console.log(`  info  coverage A=${cov.a} B=${cov.b}`);

// coordinations: overlap track for primary A yields coordination for B
const coords = deriveCoordinations([trackOverlap], areas, [occA], primary);
check('coordination derived for B', coords.length === 1 && coords[0].areaId === 'b' && coords[0].primaryAreaId === 'a');

// backfill: area with earlier mission wins
const missions: Mission[] = [
  { id: 'm1', businessNo: 'b1', title: 't', areaId: 'b', assetIds: [], status: 'in_progress', priority: 'normal', note: '', updatedAt: '2026-10-01T00:00:00Z' },
  { id: 'm2', businessNo: 'b2', title: 't', areaId: 'a', assetIds: [], status: 'in_progress', priority: 'normal', note: '', updatedAt: '2026-10-05T00:00:00Z' }
];
const backfilled = backfillPrimary(areas, missions);
check('backfill picks earlier mission area (B)', backfilled[overlapKey('a', 'b')] === 'b');

// pointInBounds
check('pointInBounds true', pointInBounds({ lat: 30.7, lng: 121.5 }, areaA.bounds));
check('pointInBounds false', !pointInBounds({ lat: 30.0, lng: 121.5 }, areaA.bounds));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
