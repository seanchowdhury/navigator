export type Waypoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
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
