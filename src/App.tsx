import { MapProvider } from "react-map-gl/maplibre";
import "./App.css";
import MapView from "./pages/MapView/MapView";

export default function App() {
  return (
    <MapProvider>
      <MapView />
    </MapProvider>
  );
}
