import { MapProvider } from "react-map-gl/maplibre";
import "./App.css";
import MapView from "./pages/MapView/MapView";
import { Analytics } from "@vercel/analytics/next";

export default function App() {
  return (
    <MapProvider>
      <MapView />
      <Analytics />
    </MapProvider>
  );
}
