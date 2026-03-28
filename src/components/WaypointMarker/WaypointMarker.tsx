type WaypointMarkerProps = {
  id: string;
  lat: number;
  lng: number;
  label: string;
};

export default function WaypointMarker({
  id,
  lat,
  lng,
  label,
}: WaypointMarkerProps) {
  return <div>{label}</div>;
}
