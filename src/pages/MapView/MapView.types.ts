export type Waypoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** Minutes stopped here on the way out (the turnaround stop for the last waypoint). */
  stopMinutes: number;
  /** Minutes stopped here on the way back, on a round trip. */
  returnStopMinutes: number;
}

export type GraphNode = {
  id: number;
  lat: number;
  lng: number;
  shore_distance: number;
}

export type GraphEdge = {
  from: number;
  to: number;
  distance: number;
}

export type EditableGraph = {
  nodes: Map<number, GraphNode>;
  edges: GraphEdge[];
}
