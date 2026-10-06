'use client';

import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { MergedTrack, RescueAsset, SearchArea, SharedBelt } from '@/lib/types';

let layerSeq = 0;

export function SearchMap({
  areas,
  assets,
  belts,
  tracks
}: {
  areas: SearchArea[];
  assets: RescueAsset[];
  belts: SharedBelt[];
  tracks: MergedTrack[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    let disposed = false;
    void import('maplibre-gl').then(({ Map, Marker: MapMarker, LngLatBounds }) => {
      if (disposed || !containerRef.current) return;
      const map = new Map({
        container: containerRef.current,
        center: [121.68, 30.82],
        zoom: 8.5,
        style: 'https://demotiles.maplibre.org/style.json'
      });
      mapRef.current = map;

      map.on('load', () => {
        if (disposed) return;
        const seq = ++layerSeq;

        const box = (b: SearchArea['bounds']) => [
          [b[0], b[1]],
          [b[2], b[1]],
          [b[2], b[3]],
          [b[0], b[3]],
          [b[0], b[1]]
        ];

        areas.forEach((area) => {
          map.addSource(`area-${seq}-${area.id}`, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Polygon', coordinates: [box(area.bounds)] }
            }
          });
          map.addLayer({
            id: `area-${seq}-${area.id}-fill`,
            type: 'fill',
            source: `area-${seq}-${area.id}`,
            paint: { 'fill-color': area.status === 'active' ? '#0e7490' : '#f59e0b', 'fill-opacity': 0.14 }
          });
          map.addLayer({
            id: `area-${seq}-${area.id}-line`,
            type: 'line',
            source: `area-${seq}-${area.id}`,
            paint: { 'line-color': '#0e7490', 'line-width': 1.5 }
          });
          map.fitBounds(new LngLatBounds([area.bounds[0], area.bounds[1]], [area.bounds[2], area.bounds[3]]), {
            padding: 60
          });
        });

        // 交叠带：已定主责琥珀色，未定主责红色虚线告警
        belts.forEach((belt) => {
          const owned = !!belt.ownerAreaId;
          map.addSource(`belt-${seq}-${belt.id}`, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Polygon', coordinates: [box(belt.bounds)] }
            }
          });
          map.addLayer({
            id: `belt-${seq}-${belt.id}-fill`,
            type: 'fill',
            source: `belt-${seq}-${belt.id}`,
            paint: { 'fill-color': owned ? '#d97706' : '#dc2626', 'fill-opacity': 0.22 }
          });
          map.addLayer({
            id: `belt-${seq}-${belt.id}-line`,
            type: 'line',
            source: `belt-${seq}-${belt.id}`,
            paint: {
              'line-color': owned ? '#b45309' : '#dc2626',
              'line-width': 2,
              'line-dasharray': [2, 1]
            }
          });
        });

        // 实际航迹：实时绿、离线合并蓝、晚到补历史灰虚线
        tracks.forEach((track) => {
          const lateAll = track.latePointKeys.length >= track.points.length && track.points.length > 0;
          const id = `track-${seq}-${track.bizNo}-${track.assetId}`;
          map.addSource(id, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: track.points.map((p) => [p.lng, p.lat]) }
            }
          });
          map.addLayer({
            id: `${id}-line`,
            type: 'line',
            source: id,
            paint: {
              'line-color': lateAll ? '#6b7280' : track.offline ? '#2563eb' : '#059669',
              'line-width': 2.5,
              'line-dasharray': lateAll ? [1, 2] : [1]
            }
          });
        });

        markersRef.current = assets.map(
          (asset) =>
            new MapMarker({ color: asset.status === 'offline' ? '#dc2626' : '#0f766e' })
              .setLngLat([asset.lng, asset.lat])
              .addTo(map)
        );
      });
    });

    return () => {
      disposed = true;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [areas, assets, belts, tracks]);

  return <div ref={containerRef} className="map-shell" aria-label="搜救海域地图（含共享带与实际航迹）" />;
}
