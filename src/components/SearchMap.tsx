'use client';

import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { RescueAsset, SearchArea, TrackPoint } from '@/lib/types';
import type { OverlapPair } from '@/lib/ledger';

interface SearchMapProps {
  areas: SearchArea[];
  assets: RescueAsset[];
  tracks: TrackPoint[];
  overlaps: OverlapPair[];
}

export function SearchMap({ areas, assets, tracks, overlaps }: SearchMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    let disposed = false;
    void import('maplibre-gl').then(({ Map: MapClass, Marker: MapMarker, LngLatBounds }) => {
      if (disposed || !containerRef.current) return;
      const map = new MapClass({ container: containerRef.current, center: [121.68, 30.82], zoom: 8.5, style: 'https://demotiles.maplibre.org/style.json' });
      mapRef.current = map;
      map.on('load', () => {
        areas.forEach((area) => {
          map.addSource(area.id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[area.bounds[0], area.bounds[1]], [area.bounds[2], area.bounds[1]], [area.bounds[2], area.bounds[3]], [area.bounds[0], area.bounds[3]], [area.bounds[0], area.bounds[1]]]] } } });
          map.addLayer({ id: `${area.id}-fill`, type: 'fill', source: area.id, paint: { 'fill-color': area.status === 'active' ? '#0e7490' : '#f59e0b', 'fill-opacity': .22 } });
          map.fitBounds(new LngLatBounds([area.bounds[0], area.bounds[1]], [area.bounds[2], area.bounds[3]]), { padding: 60 });
        });
        // 交叠水域：虚线框
        overlaps.forEach((ov) => {
          const [w, s, e, n] = ov.intersection;
          map.addSource(ov.key, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } } });
          map.addLayer({ id: `${ov.key}-line`, type: 'line', source: ov.key, paint: { 'line-color': '#7c3aed', 'line-width': 2, 'line-dasharray': [4, 3] } });
        });
        // 实际航迹：按业务编号分组连线
        const byBusiness = new Map<string, TrackPoint[]>();
        tracks.filter((t) => t.merged).forEach((t) => {
          const arr = byBusiness.get(t.businessNo) ?? [];
          arr.push(t);
          byBusiness.set(t.businessNo, arr);
        });
        byBusiness.forEach((pts, businessNo) => {
          const sorted = [...pts].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
          const color = sorted[0]?.source === 'offline' ? '#2563eb' : '#0f766e';
          map.addSource(`track-${businessNo}`, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: sorted.map((p) => [p.lng, p.lat]) } } });
          map.addLayer({ id: `track-${businessNo}`, type: 'line', source: `track-${businessNo}`, paint: { 'line-color': color, 'line-width': 2, 'line-opacity': .85 } });
        });
        markersRef.current = assets.map((asset) => new MapMarker({ color: asset.status === 'offline' ? '#dc2626' : '#0f766e' }).setLngLat([asset.lng, asset.lat]).addTo(map));
      });
    });
    return () => { disposed = true; markersRef.current.forEach((marker) => marker.remove()); mapRef.current?.remove(); };
  }, [areas, assets, tracks, overlaps]);

  return <div ref={containerRef} className="map-shell" aria-label="搜救海域地图" />;
}
