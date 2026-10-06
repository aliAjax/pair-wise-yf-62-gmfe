import type { Bounds4, TrackPoint } from '../types';

/** 覆盖率栅格边长（度），约 1.8～2.2km 见方 */
export const GRID_DEG = 0.02;
/** 记账时段：15 分钟，同一单位同一时段只计入一个搜索区 */
export const SLOT_MINUTES = 15;

export function pointInBounds(lng: number, lat: number, b: Bounds4): boolean {
  return lng >= b[0] && lat >= b[1] && lng <= b[2] && lat <= b[3];
}

export function intersects(a: Bounds4, b: Bounds4): boolean {
  return !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
}

export function intersection(a: Bounds4, b: Bounds4): Bounds4 | null {
  if (!intersects(a, b)) return null;
  return [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3])
  ];
}

export function cellKey(lng: number, lat: number): string {
  return `${Math.floor(lng / GRID_DEG)}:${Math.floor(lat / GRID_DEG)}`;
}

/** 把搜索区边界框栅格化为覆盖格全集 */
export function rasterizeArea(b: Bounds4): Set<string> {
  const cells = new Set<string>();
  for (let lng = b[0]; lng < b[2]; lng += GRID_DEG) {
    for (let lat = b[1]; lat < b[3]; lat += GRID_DEG) {
      cells.add(cellKey(lng + GRID_DEG / 2, lat + GRID_DEG / 2));
    }
  }
  return cells;
}

/** 沿相邻航迹点插值，保证每段至少以栅格粒度采样，避免高速飞漏 */
export function expandTrack(points: TrackPoint[]): TrackPoint[] {
  const out: TrackPoint[] = [];
  points.forEach((p, i) => {
    out.push(p);
    const q = points[i + 1];
    if (!q) return;
    const dLng = Math.abs(q.lng - p.lng);
    const dLat = Math.abs(q.lat - p.lat);
    const steps = Math.max(1, Math.ceil(Math.max(dLng, dLat) / GRID_DEG));
    for (let s = 1; s < steps; s++) {
      const r = s / steps;
      out.push({
        t: new Date(new Date(p.t).getTime() + (new Date(q.t).getTime() - new Date(p.t).getTime()) * r).toISOString(),
        lng: p.lng + (q.lng - p.lng) * r,
        lat: p.lat + (q.lat - p.lat) * r
      });
    }
  });
  return out;
}

export function slotStart(date: Date): Date {
  const d = new Date(date);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / SLOT_MINUTES) * SLOT_MINUTES, 0, 0);
  return d;
}

export function slotKey(iso: string): string {
  return slotStart(new Date(iso)).toISOString();
}

/** 枚举时间窗覆盖的全部记账时段（左闭右开） */
export function enumerateSlots(windowStart: string, windowEnd: string): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  let cur = slotStart(new Date(windowStart));
  const end = new Date(windowEnd);
  let guard = 0;
  while (cur < end && guard++ < 256) {
    const next = new Date(cur.getTime() + SLOT_MINUTES * 60_000);
    slots.push({ start: cur.toISOString(), end: next.toISOString() });
    cur = next;
  }
  return slots;
}
