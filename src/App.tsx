import { MapProvider } from "react-map-gl/maplibre";
import { Analytics } from "@vercel/analytics/react";
import "./App.css";
import MapView from "./pages/MapView/MapView";

export default function App() {
  return (
    <MapProvider>
      <Analytics />
      <MapView />
    </MapProvider>
  );
}
