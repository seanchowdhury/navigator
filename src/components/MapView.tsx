import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { useRef, useState, useEffect } from 'react';
import Map, { Marker } from '@vis.gl/react-maplibre';
import type { MapRef, MapLayerMouseEvent } from '@vis.gl/react-maplibre';
import type { Waypoint } from '../types';

interface MapViewProps {
  waypoints: Waypoint[];
  center: [number, number];
  onAddWaypoint: (coords: { lat: number; lng: number }) => void;
  onRemoveWaypoint: (id: string) => void;
}

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';


export default function MapView({
  waypoints,
  center,
  onAddWaypoint,
  onRemoveWaypoint,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [blockedPos, setBlockedPos] = useState<{ lng: number; lat: number } | null>(null);

  function handleClick(e: MapLayerMouseEvent) {
    const map = mapRef.current;
    if (!map) return;

    const features = map.queryRenderedFeatures(e.point);
    const isWater = features.some(
      (f) => f.sourceLayer === 'water' || f.sourceLayer === 'waterway',
    );
    const isBridgeOrTunnel = features.some(
      (f) =>
        f.sourceLayer === 'transportation' &&
        (f.properties?.bridge || f.properties?.tunnel),
    );

    if (isWater || isBridgeOrTunnel) {
      onAddWaypoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    } else {
      setBlockedPos(e.lngLat);
      setTimeout(() => setBlockedPos(null), 1200);
    }
  }

  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    if (!map) return;

    const coordinates = waypoints.map((wp) => [wp.lng, wp.lat]);
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: coordinates.length >= 2
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }]
        : [],
    };
    console.log('layer:', map.getLayer('route-line'));
    console.log('data:', JSON.stringify(data));
    (map.getSource('route') as maplibregl.GeoJSONSource).setData(data);
  }, [waypoints, mapLoaded]);

  return (
    <Map
      ref={mapRef}
      initialViewState={{
        longitude: center[1],
        latitude: center[0],
        zoom: 13,
      }}
      style={{ height: '100vh', width: '100%' }}
      mapStyle={MAP_STYLE}
      onClick={handleClick}
      cursor="crosshair"
      onLoad={(e) => {
        const map = e.target;
        map.addSource('openseamap', {
          type: 'raster',
          tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'],
          tileSize: 256,
        });
        map.addLayer({ id: 'openseamap-layer', type: 'raster', source: 'openseamap', paint: { 'raster-opacity': 0.8 } });
        map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#2563eb', 'line-width': 2 } });
        setMapLoaded(true);
      }}
    >

      {waypoints.map((wp) => (
        <Marker
          key={wp.id}
          longitude={wp.lng}
          latitude={wp.lat}
          anchor="center"
        >
          <div
            onMouseEnter={() => setHoveredId(wp.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={(e) => {
              e.stopPropagation();
              onRemoveWaypoint(wp.id);
            }}
            style={{
              background: hoveredId === wp.id ? '#dc2626' : '#2563eb',
              color: 'white',
              borderRadius: '50%',
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: hoveredId === wp.id ? 16 : 11,
              fontWeight: 'bold',
              border: '2px solid white',
              boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
              fontFamily: 'sans-serif',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            {hoveredId === wp.id ? '✕' : wp.label}
          </div>
        </Marker>
      ))}

      {blockedPos && (
        <Marker longitude={blockedPos.lng} latitude={blockedPos.lat} anchor="center">
          <div
            style={{
              background: '#dc2626',
              color: 'white',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              border: '2px solid white',
              boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
              opacity: 0.85,
              pointerEvents: 'none',
            }}
          >
            ⊘
          </div>
        </Marker>
      )}
    </Map>
  );
}
