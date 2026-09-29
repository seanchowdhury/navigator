import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GraphNode, GraphEdge } from "../MapView.types";

export type GraphMode = "select" | "add-node" | "link";

export type GraphSelection =
  | { type: "nodes"; ids: number[] }
  | { type: "edge"; index: number }
  | null;

interface GraphEditorProps {
  loaded: boolean;
  loading: boolean;
  editMode: boolean;
  onToggleEditMode: () => void;
  onLoad: () => void;
  onReset: () => void;
  onExport: () => void;
  dirty: boolean;
  nodeCount: number;
  edgeCount: number;
  mode: GraphMode;
  onModeChange: (mode: GraphMode) => void;
  linkFromId: number | null;
  selection: GraphSelection;
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  onUpdateSelectedNode: (patch: Partial<Pick<GraphNode, "lat" | "lng" | "shore_distance">>) => void;
  onDeleteSelection: () => void;
  onClearSelection: () => void;
}

export default function GraphEditor({
  loaded,
  loading,
  editMode,
  onToggleEditMode,
  onLoad,
  onReset,
  onExport,
  dirty,
  nodeCount,
  edgeCount,
  mode,
  onModeChange,
  linkFromId,
  selection,
  selectedNode,
  selectedEdge,
  onUpdateSelectedNode,
  onDeleteSelection,
  onClearSelection,
}: GraphEditorProps) {
  if (!loaded) {
    return (
      <Card className="absolute top-4 right-4 z-10 w-64" style={{ padding: 10 }}>
        <CardHeader className="pb-2">
          <CardTitle>Water Graph</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">
            Loads the routing graph baked into the app so you can inspect and
            fix it (e.g. Roosevelt Island / DeGraw Street being treated as
            water).
          </p>
          <Button size="sm" className="w-full" onClick={onLoad} disabled={loading}>
            {loading ? "Loading..." : "Load Graph"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="absolute top-4 right-4 z-10 w-72" style={{ padding: 10 }}>
      <CardHeader className="pb-2">
        <CardTitle>Water Graph</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Nodes / Edges</span>
            <span className="font-medium">
              {nodeCount} / {edgeCount}
            </span>
          </div>

          <Button
            size="sm"
            variant={editMode ? "default" : "outline"}
            className="w-full"
            onClick={onToggleEditMode}
          >
            {editMode ? "Editing (click map to edit)" : "View Only — enable editing"}
          </Button>

          {editMode && (
            <>
              <div className="rounded-md border border-border bg-muted/30 space-y-2" style={{ padding: 6 }}>
                <div className="font-bold text-xs uppercase tracking-wide text-foreground">
                  Mode
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <Button
                    size="sm"
                    variant={mode === "select" ? "default" : "outline"}
                    onClick={() => onModeChange("select")}
                  >
                    Select
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === "add-node" ? "default" : "outline"}
                    onClick={() => onModeChange("add-node")}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === "link" ? "default" : "outline"}
                    onClick={() => onModeChange("link")}
                  >
                    Link
                  </Button>
                </div>
                {mode === "add-node" && (
                  <p className="text-xs text-muted-foreground">
                    Click the map to add a node.
                  </p>
                )}
                {mode === "select" && (
                  <p className="text-xs text-muted-foreground">
                    Shift+click to add/remove nodes, Shift+drag to box-select.
                  </p>
                )}
                {mode === "link" && (
                  <p className="text-xs text-muted-foreground">
                    {linkFromId === null
                      ? "Click a node to start an edge."
                      : `Click another node to connect to #${linkFromId}.`}
                  </p>
                )}
              </div>

              {selection?.type === "nodes" && selection.ids.length > 1 && (
                <div className="rounded-md border border-border bg-muted/30 space-y-2" style={{ padding: 6 }}>
                  <div className="font-bold text-xs uppercase tracking-wide text-foreground">
                    {selection.ids.length} nodes selected
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={onClearSelection}>
                      Clear
                    </Button>
                    <Button size="sm" variant="destructive" className="flex-1" onClick={onDeleteSelection}>
                      Delete {selection.ids.length} Nodes
                    </Button>
                  </div>
                </div>
              )}

              {selection?.type === "nodes" && selection.ids.length === 1 && selectedNode && (
                <div className="rounded-md border border-border bg-muted/30 space-y-2" style={{ padding: 6 }}>
                  <div className="font-bold text-xs uppercase tracking-wide text-foreground">
                    Node #{selectedNode.id}
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-muted-foreground text-xs">Lat</span>
                    <Input
                      type="number"
                      step="0.00001"
                      value={selectedNode.lat}
                      onChange={(e) => onUpdateSelectedNode({ lat: Number(e.target.value) })}
                      className="w-32 text-right"
                    />
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-muted-foreground text-xs">Lng</span>
                    <Input
                      type="number"
                      step="0.00001"
                      value={selectedNode.lng}
                      onChange={(e) => onUpdateSelectedNode({ lng: Number(e.target.value) })}
                      className="w-32 text-right"
                    />
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-muted-foreground text-xs">Shore dist (m)</span>
                    <Input
                      type="number"
                      step="1"
                      value={selectedNode.shore_distance}
                      onChange={(e) => onUpdateSelectedNode({ shore_distance: Number(e.target.value) })}
                      className="w-32 text-right"
                    />
                  </div>
                  <Button size="sm" variant="destructive" className="w-full" onClick={onDeleteSelection}>
                    Delete Node
                  </Button>
                </div>
              )}

              {selection?.type === "edge" && selectedEdge && (
                <div className="rounded-md border border-border bg-muted/30 space-y-2" style={{ padding: 6 }}>
                  <div className="font-bold text-xs uppercase tracking-wide text-foreground">
                    Edge #{selectedEdge.from} → #{selectedEdge.to}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground text-xs">Distance</span>
                    <span className="font-medium">{selectedEdge.distance.toFixed(1)} m</span>
                  </div>
                  <Button size="sm" variant="destructive" className="w-full" onClick={onDeleteSelection}>
                    Delete Edge
                  </Button>
                </div>
              )}
            </>
          )}

          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={onReset} disabled={!dirty}>
              Discard Edits
            </Button>
            <Button size="sm" className="flex-1" onClick={onExport} disabled={!dirty}>
              Export JSON
            </Button>
          </div>
          {dirty && (
            <p className="text-xs text-muted-foreground">
              Export, then run{" "}
              <code className="bg-muted px-1 rounded">
                cargo run -p navigator_offline --bin build_graph -- graph.edited.json navigator_core/graph.bin
              </code>{" "}
              and rebuild the WASM package (<code className="bg-muted px-1 rounded">wasm-pack build</code> in{" "}
              <code className="bg-muted px-1 rounded">navigator_core/</code>) to apply.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
