import { useState, useEffect } from 'react'
import './App.css'
import MapView from './components/MapView'
import type { Waypoint } from './types'

export default function App() {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([])
  const [center, setCenter] = useState<[number, number]>([40.7282, -74.0094])

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setCenter([pos.coords.latitude, pos.coords.longitude]),
      () => {} // silently fall back to default
    )
  }, [])

  function handleAddWaypoint({ lat, lng }: { lat: number; lng: number }) {
    setWaypoints((prev) => {
      const num = prev.length + 1
      return [...prev, { id: crypto.randomUUID(), lat, lng, label: String(num) }]
    })
  }

  function handleRemoveWaypoint(id: string) {
    setWaypoints((prev) => {
      const updated = prev.filter((wp) => wp.id !== id)
      return updated.map((wp, i) => ({ ...wp, label: String(i + 1) }))
    })
  }

  return (
    <MapView
      waypoints={waypoints}
      center={center}
      onAddWaypoint={handleAddWaypoint}
      onRemoveWaypoint={handleRemoveWaypoint}
    />
  )
}
