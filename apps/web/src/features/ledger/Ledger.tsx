import { useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, colorSchemeDarkBlue, themeQuartz, type ColDef } from "ag-grid-community";
import { Table2 } from "lucide-react";
import type { MilestoneStatus } from "@arko/shared";
import { formatMoney, STATUS_META } from "../../lib/format.ts";
import { useStore } from "../../lib/store.tsx";

ModuleRegistry.registerModules([AllCommunityModule]);

interface Row {
  dealId: string;
  deal: string;
  milestone: string;
  client: string;
  freelancer: string;
  amount: number;
  paid: number;
  currency: string;
  status: MilestoneStatus;
  orderId?: string;
  authorizationId?: string;
  captureId?: string;
  invoiceId?: string;
  updatedAt: string;
}

const useDark = () => {
  const q = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const [dark, setDark] = useState(q?.matches ?? false);
  useEffect(() => {
    if (!q) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [q]);
  return dark;
};

/** Escrow ledger (AG Grid): every milestone with its PayPal order, hold, capture and receipt ids. */
export function Ledger() {
  const { deals, go } = useStore();
  const dark = useDark();
  const theme = useMemo(
    () => (dark ? themeQuartz.withPart(colorSchemeDarkBlue) : themeQuartz).withParams({ fontFamily: "Inter, sans-serif", accentColor: "#4f46e5" }),
    [dark],
  );

  const rows: Row[] = useMemo(
    () =>
      deals.flatMap((d) =>
        d.milestones.map((m) => ({
          dealId: d.id,
          deal: d.title,
          milestone: m.title,
          client: d.clientName,
          freelancer: d.freelancerName,
          amount: Number(m.amount),
          paid: Number(m.capturedAmount ?? 0),
          currency: d.currency,
          status: m.status,
          orderId: m.paypal.orderId,
          authorizationId: m.paypal.authorizationId,
          captureId: m.paypal.captureId,
          invoiceId: m.paypal.invoiceId,
          updatedAt: m.updatedAt,
        })),
      ),
    [deals],
  );

  const cols: ColDef<Row>[] = useMemo(
    () => [
      { field: "deal", headerName: "Deal", flex: 1.4, minWidth: 180, filter: true },
      { field: "milestone", flex: 1.4, minWidth: 180, filter: true },
      { field: "freelancer", minWidth: 130, filter: true },
      { field: "client", minWidth: 130, filter: true },
      {
        field: "status",
        minWidth: 160,
        filter: true,
        valueFormatter: (p) => (p.value ? STATUS_META[p.value as MilestoneStatus].label : ""),
        cellRenderer: (p: { value: MilestoneStatus }) => <span className={`chip ${STATUS_META[p.value].tone}`}>{STATUS_META[p.value].label}</span>,
      },
      { field: "amount", headerName: "Held / agreed", type: "rightAligned", minWidth: 130, valueFormatter: (p) => formatMoney(p.value ?? 0, p.data?.currency) },
      { field: "paid", headerName: "Paid out", type: "rightAligned", minWidth: 120, valueFormatter: (p) => formatMoney(p.value ?? 0, p.data?.currency) },
      { field: "orderId", headerName: "PayPal order", minWidth: 170, cellClass: "font-mono text-xs" },
      { field: "authorizationId", headerName: "Authorization", minWidth: 170, cellClass: "font-mono text-xs" },
      { field: "captureId", headerName: "Capture", minWidth: 170, cellClass: "font-mono text-xs" },
      { field: "invoiceId", headerName: "Receipt invoice", minWidth: 190, cellClass: "font-mono text-xs" },
      { field: "updatedAt", headerName: "Updated", minWidth: 160, sort: "desc", valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString() : "") },
    ],
    [],
  );

  const totals = rows.reduce(
    (t, r) => {
      if (["funded", "submitted", "verified", "disputed", "mediated"].includes(r.status)) t.held += r.amount;
      t.paid += r.paid;
      return t;
    },
    { held: 0, paid: 0 },
  );

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Table2 className="size-6 text-brand-600" /> Escrow ledger
          </h1>
          <p className="text-sm text-slate-500">Every milestone and its PayPal trail. Click a row to open the deal.</p>
        </div>
        <div className="flex gap-4 text-sm">
          <span>
            Held now: <b className="tabular-nums">{formatMoney(totals.held)}</b>
          </span>
          <span>
            Paid out: <b className="tabular-nums">{formatMoney(totals.paid)}</b>
          </span>
        </div>
      </header>
      <div className="min-h-[420px] flex-1">
        <AgGridReact<Row>
          theme={theme}
          rowData={rows}
          columnDefs={cols}
          defaultColDef={{ sortable: true, resizable: true }}
          pagination
          paginationPageSize={20}
          onRowClicked={(e) => e.data && go({ name: "deal", id: e.data.dealId })}
          rowClass="cursor-pointer"
          overlayNoRowsTemplate="No milestones yet — create a deal to get started."
        />
      </div>
    </div>
  );
}
