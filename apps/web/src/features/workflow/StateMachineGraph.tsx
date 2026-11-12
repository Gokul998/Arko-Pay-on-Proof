import { useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, CheckCircle2, CircleDashed, CreditCard, Flag, GitFork, Hourglass, Layers, OctagonAlert, Play, Repeat2, User, X } from "lucide-react";
import type { Deal } from "@arko/shared";
import { buildStateMachine, type StepNode } from "../../lib/stategraph.ts";
import type { NodeState } from "../../lib/orchestration.ts";

type Data = StepNode & Record<string, unknown>;

const ACCENT: Record<StepNode["layer"], { bar: string; icon: React.ReactNode; text: string; glow: string }> = {
  human: { bar: "from-indigo-500 to-blue-500", icon: <User className="size-3.5" />, text: "text-indigo-600 dark:text-indigo-300", glow: "shadow-indigo-500/30" },
  ai: { bar: "from-fuchsia-500 to-violet-500", icon: <Bot className="size-3.5" />, text: "text-violet-600 dark:text-violet-300", glow: "shadow-violet-500/30" },
  paypal: { bar: "from-sky-500 to-cyan-400", icon: <CreditCard className="size-3.5" />, text: "text-sky-600 dark:text-sky-300", glow: "shadow-sky-500/30" },
  system: { bar: "from-slate-400 to-slate-500", icon: <Layers className="size-3.5" />, text: "text-slate-500", glow: "shadow-slate-500/20" },
};

const STATE_RING: Record<NodeState, string> = {
  done: "ring-emerald-400/70",
  active: "ring-brand-500 ring-2",
  waiting: "ring-slate-300/60 dark:ring-slate-700",
  alert: "ring-amber-400 ring-2",
  skipped: "ring-slate-200 dark:ring-slate-800 opacity-40",
};

const STATE_ICON: Record<NodeState, React.ReactNode> = {
  done: <CheckCircle2 className="size-4 text-emerald-500" />,
  active: (
    <span className="relative flex size-3">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-70" />
      <span className="relative inline-flex size-3 rounded-full bg-brand-600" />
    </span>
  ),
  waiting: <Hourglass className="size-3.5 text-slate-400" />,
  alert: <OctagonAlert className="size-4 text-amber-500" />,
  skipped: <CircleDashed className="size-3.5 text-slate-400" />,
};

const hidden = { opacity: 0, width: 6, height: 6, border: 0 };
const Handles = () => (
  <>
    <Handle type="target" position={Position.Top} style={hidden} isConnectable={false} />
    <Handle type="source" position={Position.Bottom} style={hidden} isConnectable={false} />
  </>
);

function TaskNode({ data }: NodeProps<Node<Data>>) {
  const a = ACCENT[data.layer];
  const isWait = data.kind === "wait";
  return (
    <div
      style={{ width: data.width }}
      className={`group relative overflow-hidden rounded-2xl bg-white/90 ring-1 backdrop-blur transition hover:-translate-y-0.5 hover:shadow-xl dark:bg-slate-900/90 ${STATE_RING[data.state]} ${data.state === "active" ? `shadow-lg ${a.glow}` : "shadow-sm"}`}
    >
      <Handles />
      <div className={`absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${a.bar}`} />
      <div className="py-2.5 pr-3 pl-4">
        <div className="flex items-center justify-between gap-2">
          <span className={`flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase ${a.text}`}>
            {a.icon} {data.layer === "paypal" ? "PayPal" : data.layer === "ai" ? "AI agent" : data.layer === "human" ? "Human" : "System"}
            {isWait && <span className="ml-1 rounded bg-slate-100 px-1 text-[9px] text-slate-500 dark:bg-slate-800">WAIT</span>}
          </span>
          {STATE_ICON[data.state]}
        </div>
        <div className="mt-1 text-[13px] leading-tight font-semibold text-slate-900 dark:text-slate-50">{data.label}</div>
        <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400" title={data.detail}>{data.detail}</div>
      </div>
    </div>
  );
}

function HeaderNode({ data }: NodeProps<Node<Data>>) {
  return (
    <div style={{ width: data.width }} className={`rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-2.5 text-white shadow-lg ring-1 dark:from-slate-100 dark:to-slate-300 dark:text-slate-900 ${data.state === "active" ? "ring-brand-400" : "ring-transparent"}`}>
      <Handles />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-bold">{data.label}</span>
        {STATE_ICON[data.state]}
      </div>
      <div className="truncate text-[11px] opacity-70">{data.detail}</div>
    </div>
  );
}

function ChoiceNode({ data }: NodeProps<Node<Data>>) {
  const active = data.state === "active";
  return (
    <div className="relative grid place-items-center" style={{ width: data.width, height: data.width }}>
      <Handles />
      <div className={`absolute inset-[11px] rotate-45 rounded-xl bg-white shadow-md ring-2 dark:bg-slate-900 ${active ? "ring-brand-500 shadow-brand-500/30" : data.state === "done" ? "ring-emerald-400" : data.state === "skipped" ? "opacity-40 ring-slate-300" : "ring-slate-300 dark:ring-slate-700"}`} />
      <span className="relative text-[11px] font-bold text-slate-700 dark:text-slate-200">{data.label}</span>
    </div>
  );
}

function BarNode({ data }: NodeProps<Node<Data>>) {
  const fork = data.kind === "fork";
  return (
    <div style={{ width: data.width }} className="flex flex-col items-center gap-1">
      <Handles />
      <div className={`h-2 w-full rounded-full ${data.state === "done" ? "bg-gradient-to-r from-emerald-400 to-teal-400" : data.state === "active" ? "bg-gradient-to-r from-brand-500 to-violet-500" : "bg-slate-300 dark:bg-slate-700"}`} />
      <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
        {fork ? <GitFork className="size-3" /> : <Layers className="size-3" />} {data.label} · {data.detail}
      </span>
    </div>
  );
}

function MapNode({ data }: NodeProps<Node<Data>>) {
  return (
    <div style={{ width: data.width }} className="relative">
      <Handles />
      <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-2xl bg-violet-200/60 dark:bg-violet-900/40" />
      <div className="absolute inset-0 translate-x-0.5 translate-y-0.5 rounded-2xl bg-violet-300/60 dark:bg-violet-800/40" />
      <div className={`relative rounded-2xl bg-gradient-to-r from-brand-600 to-violet-600 px-4 py-2.5 text-white shadow-lg ${data.state === "active" ? "shadow-brand-500/40" : ""}`}>
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase opacity-80">
          <Repeat2 className="size-3.5" /> Map · parallel
        </div>
        <div className="text-[13px] font-bold">{data.label}</div>
        <div className="text-[11px] opacity-80">{data.detail}</div>
      </div>
    </div>
  );
}

function TerminalNode({ data }: NodeProps<Node<Data>>) {
  const start = data.kind === "start";
  return (
    <div style={{ width: data.width, height: data.width }} className={`grid place-items-center rounded-full text-white shadow-lg ${start ? "bg-gradient-to-br from-emerald-500 to-teal-500" : data.state === "done" ? "bg-gradient-to-br from-emerald-500 to-teal-500" : "bg-gradient-to-br from-slate-500 to-slate-700"}`}>
      <Handles />
      {start ? <Play className="size-5" /> : <Flag className="size-5" />}
    </div>
  );
}

function SuccessNode({ data }: NodeProps<Node<Data>>) {
  const done = data.state === "done";
  return (
    <div style={{ width: data.width }} className={`rounded-full px-4 py-2 text-center text-[12px] font-bold shadow-md ring-1 ${done ? (data.label.startsWith("Cancelled") ? "bg-rose-50 text-rose-700 ring-rose-300 dark:bg-rose-950/40 dark:text-rose-300" : "bg-emerald-50 text-emerald-700 ring-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300") : "bg-white text-slate-500 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"}`}>
      <Handles />
      {data.label}
    </div>
  );
}

const nodeTypes = { task: TaskNode, wait: TaskNode, header: HeaderNode, choice: ChoiceNode, fork: BarNode, join: BarNode, map: MapNode, start: TerminalNode, end: TerminalNode, success: SuccessNode };

const EDGE_STYLE = {
  traversed: { stroke: "#10b981", strokeWidth: 2.2 },
  active: { stroke: "#6366f1", strokeWidth: 2.6 },
  pending: { stroke: "#94a3b8", strokeWidth: 1.4, strokeDasharray: "5 5" },
  skipped: { stroke: "#cbd5e1", strokeWidth: 1, strokeDasharray: "2 6", opacity: 0.5 },
} as const;

/** Step Functions–style execution graph of the whole deal, with a details drawer. */
export function StateMachineGraph({ deal, onOpen }: { deal: Deal; onOpen: (milestoneId?: string) => void }) {
  const [selected, setSelected] = useState<StepNode | null>(null);
  const { nodes, edges, focus } = useMemo(() => {
    const g = buildStateMachine(deal);
    // Open on what is happening now (running / attention steps and their lane headers), not the whole tree.
    const hot = g.nodes.filter((n) => (n.state === "active" || n.state === "alert") && n.kind !== "map" && n.kind !== "header");
    const focusIds = new Set(hot.map((n) => n.id));
    hot.forEach((n) => n.milestoneId && focusIds.add(`${n.milestoneId}:head`));
    const focus = focusIds.size ? [...focusIds].map((id) => ({ id })) : undefined;
    const nodes: Node<Data>[] = g.nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: { x: n.x - n.width / 2, y: n.y },
      data: n as Data,
      draggable: false,
      connectable: false,
    }));
    const edges: Edge[] = g.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: e.state === "active",
      label: e.label,
      labelStyle: { fontSize: 10, fontWeight: 700, fill: e.label === "dispute" ? "#d97706" : "#059669" },
      labelBgStyle: { fill: "var(--xy-background-color, #fff)" },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 6,
      style: EDGE_STYLE[e.state],
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: EDGE_STYLE[e.state].stroke },
      pathOptions: { borderRadius: 14 },
    }));
    return { nodes, edges, focus };
  }, [deal]);

  return (
    <div className="relative h-[760px] overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white dark:border-slate-800 dark:from-slate-950 dark:to-slate-900">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ nodes: focus, padding: 0.18, maxZoom: 1.05, minZoom: 0.45 }}
        minZoom={0.2}
        maxZoom={1.6}
        colorMode="system"
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => setSelected(n.data as StepNode)}
        onPaneClick={() => setSelected(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeBorderRadius={8}
          nodeColor={(n) => ({ done: "#10b981", active: "#6366f1", alert: "#f59e0b", waiting: "#94a3b8", skipped: "#cbd5e1" })[(n.data as unknown as StepNode).state]}
          maskColor="rgba(100,116,139,0.15)"
          className="!rounded-xl !border !border-slate-200 dark:!border-slate-700"
        />
      </ReactFlow>

      {/* Legend */}
      <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap gap-1.5 text-[10px] font-semibold">
        {[
          ["bg-emerald-500", "Succeeded"],
          ["bg-brand-600", "In progress"],
          ["bg-amber-500", "Needs attention"],
          ["bg-slate-400", "Not started"],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900/90 dark:ring-slate-700">
            <span className={`size-2 rounded-full ${c}`} /> {l}
          </span>
        ))}
      </div>

      {/* Execution details drawer */}
      {selected && (
        <aside className="absolute top-3 right-3 bottom-3 w-80 overflow-y-auto rounded-2xl bg-white/95 p-4 shadow-2xl ring-1 ring-slate-200 backdrop-blur dark:bg-slate-900/95 dark:ring-slate-700">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className={`text-[10px] font-bold tracking-wider uppercase ${ACCENT[selected.layer].text}`}>{selected.stepType}</div>
              <h3 className="mt-1 text-base font-bold">{selected.label}</h3>
            </div>
            <button className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setSelected(null)} aria-label="Close details">
              <X className="size-4" />
            </button>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <Row k="Status">
              <span className="flex items-center gap-1.5 capitalize">{STATE_ICON[selected.state]} {selected.state === "done" ? "succeeded" : selected.state === "active" ? "in progress" : selected.state === "alert" ? "needs attention" : selected.state === "skipped" ? "skipped (other branch)" : "not started"}</span>
            </Row>
            <Row k="Executed by">{selected.layer === "paypal" ? "PayPal (via Arko MCP server)" : selected.layer === "ai" ? "Claude agent" : selected.layer === "human" ? "A person (approval gate)" : "Arko orchestrator"}</Row>
            <Row k="Output">{selected.detail}</Row>
            {selected.milestoneId && <Row k="Milestone">{deal.milestones.find((m) => m.id === selected.milestoneId)?.title}</Row>}
          </dl>
          <button className="btn-primary mt-5 w-full" onClick={() => onOpen(selected.milestoneId)}>
            {selected.milestoneId ? "Open milestone" : "Open plan & terms"}
          </button>
        </aside>
      )}
    </div>
  );
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div>
    <dt className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{k}</dt>
    <dd className="mt-0.5">{children}</dd>
  </div>
);
