import { Bot, Building2, CheckCircle2, CircleDashed, CreditCard, Hourglass, Link2, OctagonAlert, User, UserCheck, Workflow } from "lucide-react";
import { daysBetween, today, type Deal } from "@arko/shared";
import { formatMoney } from "../../lib/format.ts";
import { milestoneFlow, nextActions, planningFlow, type FlowNode, type Layer, type NodeState } from "../../lib/orchestration.ts";
import { useStore } from "../../lib/store.tsx";
import { useState } from "react";
import { Network, Rows3 } from "lucide-react";
import { StateMachineGraph } from "./StateMachineGraph.tsx";
import { StatusBadge } from "../../components/ui.tsx";

const LAYER: Record<Layer, { label: string; icon: React.ReactNode; ring: string; chip: string }> = {
  human: { label: "Human decision", icon: <User className="size-3.5" />, ring: "ring-indigo-400/60", chip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" },
  ai: { label: "AI agent", icon: <Bot className="size-3.5" />, ring: "ring-violet-400/60", chip: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  paypal: { label: "PayPal rail", icon: <CreditCard className="size-3.5" />, ring: "ring-sky-400/60", chip: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
};

const STATE: Record<NodeState, { cls: string; icon: React.ReactNode }> = {
  done: { cls: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40", icon: <CheckCircle2 className="size-4 text-emerald-600" /> },
  active: { cls: "border-brand-500 bg-white shadow-md shadow-brand-500/10 dark:bg-slate-900", icon: <span className="relative flex size-3"><span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-60" /><span className="relative inline-flex size-3 rounded-full bg-brand-600" /></span> },
  waiting: { cls: "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50", icon: <Hourglass className="size-4 text-slate-400" /> },
  alert: { cls: "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40", icon: <OctagonAlert className="size-4 text-amber-600" /> },
  skipped: { cls: "border-dashed border-slate-200 bg-transparent opacity-50 dark:border-slate-800", icon: <CircleDashed className="size-4 text-slate-400" /> },
};

/**
 * The orchestration map: planning layer + one execution lane per milestone, every step tagged
 * with who runs it (human / AI agent / PayPal) and its live state.
 */
export function WorkflowMap({ deal, onOpen }: { deal: Deal; onOpen: (milestoneId?: string) => void }) {
  const { actions, party } = useStore();
  const queue = nextActions(deal, actions.filter((a) => a.dealId === deal.id));
  const mine = queue.filter((q) => q.who === party || q.who === "anyone");
  const theirs = queue.filter((q) => q.who !== party && q.who !== "anyone");
  const [view, setView] = useState<"graph" | "lanes">("graph");

  return (
    <div className="space-y-6">
      {/* Who's on the hook */}
      <div className="grid gap-3 md:grid-cols-2">
        <Queue title={`Your next steps (${party})`} icon={<UserCheck className="size-4" />} items={mine} onOpen={onOpen} empty="Nothing waiting on you." highlight />
        <Queue title={`Waiting on the ${party === "client" ? "freelancer" : "client"}`} icon={<Building2 className="size-4" />} items={theirs} onOpen={onOpen} empty="Nothing waiting on them." />
      </div>

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Orchestration</h2>
        <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold dark:bg-slate-800">
          <button onClick={() => setView("graph")} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 ${view === "graph" ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500"}`}>
            <Network className="size-3.5" /> State machine
          </button>
          <button onClick={() => setView("lanes")} className={`flex items-center gap-1 rounded-lg px-2.5 py-1 ${view === "lanes" ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500"}`}>
            <Rows3 className="size-3.5" /> Lanes
          </button>
        </div>
      </div>

      {view === "graph" ? (
        <StateMachineGraph deal={deal} onOpen={onOpen} />
      ) : (
      <>
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-500">Layers:</span>
        {(Object.keys(LAYER) as Layer[]).map((l) => (
          <span key={l} className={`chip ${LAYER[l].chip}`}>{LAYER[l].icon} {LAYER[l].label}</span>
        ))}
      </div>

      {/* Planning layer */}
      <section className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Workflow className="size-4 text-brand-600" /> Planning & agreement</h3>
        <Lane nodes={planningFlow(deal)} onClick={() => onOpen()} />
      </section>

      {/* Execution layer */}
      <section className="card p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Workflow className="size-4 text-brand-600" /> Milestone execution</h3>
        <p className="mb-4 text-xs text-slate-500">Each lane runs on its own PayPal hold. Click a step to jump to it.</p>
        <div className="space-y-5">
          {deal.milestones.map((m) => {
            const dep = m.dependsOn ? deal.milestones.find((x) => x.id === m.dependsOn) : null;
            return (
              <div key={m.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="grid size-6 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900">{m.position}</span>
                  <button className="font-semibold hover:underline" onClick={() => onOpen(m.id)}>{m.title}</button>
                  <span className="tabular-nums text-slate-500">{formatMoney(m.amount, deal.currency)}</span>
                  <StatusBadge status={m.status} />
                  {dep && (
                    <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Link2 className="size-3" /> after M{dep.position}</span>
                  )}
                </div>
                <Lane nodes={milestoneFlow(deal, m)} onClick={() => onOpen(m.id)} />
              </div>
            );
          })}
        </div>
      </section>

      </>
      )}

      <Timeline deal={deal} />
    </div>
  );
}

function Lane({ nodes, onClick }: { nodes: FlowNode[]; onClick: () => void }) {
  return (
    <ol className="flex gap-0 overflow-x-auto pb-1">
      {nodes.map((n, i) => (
        <li key={n.key} className="flex min-w-36 flex-1 items-center">
          <button onClick={onClick} className={`group flex h-full w-full flex-col gap-1 rounded-xl border p-2.5 text-left transition hover:-translate-y-0.5 ${STATE[n.state].cls}`}>
            <div className="flex items-center justify-between gap-1">
              <span className={`chip px-1.5 ${LAYER[n.layer].chip}`}>{LAYER[n.layer].icon}</span>
              {STATE[n.state].icon}
            </div>
            <div className="text-xs font-semibold">{n.label}</div>
            <div className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{n.detail}</div>
          </button>
          {i < nodes.length - 1 && <div className={`h-0.5 w-3 shrink-0 ${n.state === "done" ? "bg-emerald-400" : "bg-slate-300 dark:bg-slate-700"}`} aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function Queue({ title, icon, items, onOpen, empty, highlight = false }: { title: string; icon: React.ReactNode; items: ReturnType<typeof nextActions>; onOpen: (id?: string) => void; empty: string; highlight?: boolean }) {
  return (
    <div className={`card p-4 ${highlight ? "ring-2 ring-brand-500/30" : ""}`}>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">{icon} {title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((q, i) => (
            <li key={i}>
              <button onClick={() => onOpen(q.milestoneId)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${q.urgent ? "bg-amber-500" : "bg-brand-500"}`} />
                <span>{q.text}{q.who === "anyone" && <span className="text-slate-400"> · either party</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Schedule view: planned vs current due dates, extensions and today. */
function Timeline({ deal }: { deal: Deal }) {
  const dated = deal.milestones.filter((m) => m.dueDate);
  if (dated.length === 0) return null;
  const start = deal.createdAt.slice(0, 10);
  const end = dated.reduce((max, m) => (m.dueDate! > max ? m.dueDate! : max), today());
  const span = Math.max(7, daysBetween(start, end) + 3);
  const pos = (d: string) => `${Math.min(100, Math.max(0, (daysBetween(start, d) / span) * 100))}%`;
  const now = today();

  return (
    <section className="card p-4">
      <h3 className="mb-3 text-sm font-semibold">Schedule</h3>
      <div className="relative space-y-3">
        <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-500" style={{ left: `calc(9rem + (100% - 9rem) * ${daysBetween(start, now) / span})` }}>
          <span className="absolute -top-1 -translate-x-1/2 rounded bg-rose-500 px-1 text-[10px] font-semibold text-white">today</span>
        </div>
        {deal.milestones.map((m) => {
          const dep = m.dependsOn ? deal.milestones.find((x) => x.id === m.dependsOn) : null;
          const from = dep?.dueDate ?? start;
          const extended = m.originalDueDate && m.dueDate && m.originalDueDate !== m.dueDate;
          const pending = m.extensions.find((e) => e.status === "pending");
          const done = ["released", "settled"].includes(m.status);
          return (
            <div key={m.id} className="grid grid-cols-[9rem_1fr] items-center gap-0 text-xs">
              <div className="truncate pr-3 font-medium">{m.position}. {m.title}</div>
              <div className="relative h-7 rounded-lg bg-slate-100 dark:bg-slate-800/60">
                {m.dueDate && (
                  <div
                    className={`absolute inset-y-1 rounded-md ${done ? "bg-emerald-500" : m.status === "cancelled" ? "bg-rose-300" : "bg-brand-500"} opacity-90`}
                    style={{ left: pos(from), width: `calc(${pos(m.dueDate)} - ${pos(from)})`, minWidth: 6 }}
                    title={`${from} → ${m.dueDate}`}
                  />
                )}
                {extended && <div className="absolute inset-y-0 w-0.5 bg-slate-400" style={{ left: pos(m.originalDueDate!) }} title={`Originally due ${m.originalDueDate}`} />}
                {pending && <div className="absolute inset-y-1 rounded-md border-2 border-dashed border-amber-500" style={{ left: pos(m.dueDate ?? from), width: `calc(${pos(pending.toDate)} - ${pos(m.dueDate ?? from)})` }} title={`Extension requested to ${pending.toDate}`} />}
                <span className="absolute top-1/2 right-2 -translate-y-1/2 text-[10px] font-semibold text-slate-600 dark:text-slate-300">{m.dueDate ?? "no date"}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-brand-500" /> planned</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-emerald-500" /> paid</span>
        <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-slate-400" /> original due date</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 rounded border-2 border-dashed border-amber-500" /> extension requested</span>
      </div>
    </section>
  );
}
