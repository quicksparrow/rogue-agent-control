"use client";

import { useEffect, useMemo, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
} from "ag-grid-community";
import type { StoredEvent } from "../lib/contracts";
import { eventLabels, summary } from "../lib/evidence";

ModuleRegistry.registerModules([AllCommunityModule]);
const theme = themeQuartz.withParams({
  accentColor: "var(--blue)",
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--text)",
  headerBackgroundColor: "var(--bg)",
  headerTextColor: "var(--navy)",
  borderColor: "var(--border)",
  rowHoverColor: "var(--blue-soft)",
  selectedRowBackgroundColor: "var(--blue-soft)",
  fontFamily: "inherit",
  fontSize: 13,
  headerFontWeight: 600,
  headerHeight: 40,
  rowHeight: 44,
  wrapperBorderRadius: 6,
});

export default function EventGrid({
  events,
  selectedId,
  onSelect,
  reveal,
}: {
  events: StoredEvent[];
  selectedId?: string;
  onSelect: (id: string) => void;
  reveal?: {eventId: string};
}) {
  const grid = useRef<AgGridReact<StoredEvent>>(null);
  const target = useRef("");
  function syncSelection(api: GridApi<StoredEvent>) {
    const node = selectedId ? api.getRowNode(selectedId) : undefined;
    if (node && (api.getSelectedNodes().length !== 1 || !node.isSelected())) {
      api.deselectAll();
      node.setSelected(true);
    }
    if (node && target.current === node.id && node.rowIndex !== null) {
      api.ensureNodeVisible(node, "middle");
      target.current = "";
    }
  }
  useEffect(() => {
    const api = grid.current?.api;
    if (api && !api.isDestroyed()) {
      const selected = selectedId ? api.getRowNode(selectedId) : undefined;
      if (selected) {
        api.deselectAll();
        selected.setSelected(true);
      }
    }
  }, [selectedId]);
  useEffect(() => {
    const api = grid.current?.api;
    if (!api || api.isDestroyed() || !reveal) return;
    target.current = reveal.eventId;
    api.setFilterModel(null);
    const frame = requestAnimationFrame(() => {
      if (api.isDestroyed()) return;
      const node = api.getRowNode(reveal.eventId);
      if (!node) return;
      api.deselectAll();
      node.setSelected(true);
      api.redrawRows();
      if (node.rowIndex !== null) api.ensureNodeVisible(node, "middle");
      target.current = "";
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal]);
  const columns = useMemo<ColDef<StoredEvent>[]>(
    () => [
      { headerName: "#", field: "sequence", width: 75, pinned: "left" },
      {
        headerName: "Event",
        field: "event_type",
        valueFormatter: (p) =>
          eventLabels[p.value as StoredEvent["event_type"]],
        minWidth: 190,
        flex: 1,
      },
      { headerName: "Actor", field: "actor", width: 140 },
      {
        headerName: "Evidence",
        valueGetter: (p) => (p.data ? summary(p.data) : ""),
        minWidth: 280,
        flex: 2,
      },
      { headerName: "Producer time (UTC)", field: "timestamp", cellClass: "evidence-id-cell", minWidth: 230 },
      {
        headerName: "Origin",
        valueGetter: (p) =>
          p.data?.provenance.mode === "synthetic"
            ? "Synthetic"
            : p.data?.provenance.mode === "integration"
              ? `Server · ${p.data.provenance.source}`
              : "External · unverified",
        minWidth: 170,
      },
      { headerName: "Event ID", field: "event_id", cellClass: "evidence-id-cell", minWidth: 220 },
      { headerName: "Run ID", field: "run_id", cellClass: "evidence-id-cell", minWidth: 220 },
      { headerName: "Trace ID", field: "trace_id", cellClass: "evidence-id-cell", minWidth: 220 },
      { headerName: "Parent event ID", field: "parent_event_id", cellClass: "evidence-id-cell", minWidth: 220 },
    ],
    [],
  );
  return (
    <div className="event-grid" data-testid="event-grid">
      <p className="grid-help">
        Select a row or press Enter to inspect an event. Use column headers to sort and filter.
      </p>
      <div className="evidence-grid-body">
        <AgGridReact<StoredEvent>
          ref={grid}
          theme={theme}
          rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: false }}
          onModelUpdated={e => syncSelection(e.api)}
          rowData={events}
          columnDefs={columns}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          getRowId={(p) => p.data.event_id}
          onRowClicked={(e) => e.data && onSelect(e.data.event_id)}
          onCellKeyDown={(e) => {
            if ((e.event as KeyboardEvent)?.key === "Enter" && e.data)
              onSelect(e.data.event_id);
          }}
          getRowClass={(params) => params.data?.event_id === selectedId ? "evidence-selected" : ""}
          overlayNoRowsTemplate="No events match the current filters."
        />
      </div>
    </div>
  );
}
