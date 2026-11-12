import { useState } from "react";
import { Activity as ActivityIcon, CheckCircle2, ClipboardList, Copy, GitBranch, Handshake, Layers, ShieldCheck, UserPlus, Wallet } from "lucide-react";
import { fromCents, toCents, type Party } from "@arko/shared";
import { api } from "../../lib/api.ts";
import { formatMoney } from "../../lib/format.ts";
import { keyring } from "../../lib/keyring.ts";
import { dealPhase, PHASES } from "../../lib/orchestration.ts";
import { useStore, type DealTab } from "../../lib/store.tsx";
import { Button, Empty } from "../../components/ui.tsx";
import { MilestoneCard } from "./MilestoneCard.tsx";
import { PlanEditor } from "../plan/PlanEditor.tsx";
import { WorkflowMap } from "../workflow/WorkflowMap.tsx";
import { DealActivity } from "../activity/Activity.tsx";

const TABS: Array<{ id: DealTab; label: string; icon: React.ReactNode }> = [
  { id: "workflow", label: "Workflow", icon: <Layers className="size-4" /> },
  { id: "plan", label: "Plan & terms", icon: <ClipboardList className="size-4" /> },
  { id: "milestones", label: "Milestones", icon: <GitBranch className="size-4" /> },
  { id: "activity", label: "Activity", icon: <ActivityIcon className="size-4" /> },
];

export function DealRoom({ id, tab }: { id: string; tab?: DealTab }) {
  const { deals, actions, party, run, busy, upsertDeal, go } = useStore();
  const deal = deals.find((d) => d.id === id);
  if (!deal) return <Empty icon={<Wallet className="size-6" />} title="Loading deal…">If this persists, open the deal from your invite link.</Empty>;

  const current: DealTab = tab ?? (deal.status === "proposed" ? "plan" : "workflow");
  const setTab = (t: DealTab) => go({ name: "deal", id, tab: t });
  const openMilestone = (msId?: string) => {
    setTab(msId ? "milestones" : deal.status === "proposed" ? "plan" : "workflow");
    if (msId) setTimeout(() => document.getElementById(`ms-${msId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const sum = (pred: (s: string) => boolean, field: "amount" | "capturedAmount" = "amount") =>
    fromCents(deal.milestones.filter((m) => pred(m.status)).reduce((t, m) => t + toCents(m[field] ?? "0"), 0));
  const total = sum(() => true);
  const held = sum((s) => ["funded", "submitted", "verified", "disputed", "mediated"].includes(s));
  const paid = sum((s) => s === "released" || s === "settled", "capturedAmount");
  const phase = dealPhase(deal);
  const accepted = deal.acceptedBy.includes(party);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
              {deal.clientName} → {deal.freelancerName} · plan v{deal.version}
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{deal.title}</h1>
            <p className="mt-1 max-w-3xl text-slate-600 dark:text-slate-400">{deal.summary}</p>
          </div>
          <InvitePanel dealId={deal.id} />
        </div>

        {/* Phase stepper */}
        <ol className="flex items-center gap-1" aria-label="Deal phase">
          {PHASES.map((p, i) => (
            <li key={p} className="flex flex-1 items-center gap-1">
              <div className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold ${i < phase ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : i === phase ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>
                {i < phase && <CheckCircle2 className="size-3.5" />} {p}
              </div>
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Deal value" value={formatMoney(total, deal.currency)} icon={<Handshake className="size-4" />} />
          <Stat label="Held by PayPal" value={formatMoney(held, deal.currency)} icon={<ShieldCheck className="size-4" />} accent="text-indigo-600" />
          <Stat label="Paid out" value={formatMoney(paid, deal.currency)} icon={<CheckCircle2 className="size-4" />} accent="text-emerald-600" />
        </div>
      </header>

      {deal.status === "proposed" && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-brand-200 bg-brand-50/60 p-4 dark:border-brand-600/30 dark:bg-brand-600/10">
          <div>
            <div className="font-semibold">Negotiating plan v{deal.version}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">
              Either side can edit the split-up, dates, deliverables and terms — each save is a new version. Money is held only after both accept the same version.
              Accepted by: <b>{deal.acceptedBy.length ? deal.acceptedBy.join(" & ") : "no one yet"}</b>.
            </div>
          </div>
          {accepted ? (
            <span className="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5" /> You accepted v{deal.version}
            </span>
          ) : (
            <Button busy={busy.accept} onClick={() => run("accept", () => api.accept(deal.id, deal.version), `Plan v${deal.version} accepted`).then((d) => d && upsertDeal(d))}>
              Accept plan v{deal.version} as {party}
            </Button>
          )}
        </div>
      )}

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={current === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap ${current === t.id ? "border-brand-600 text-brand-700 dark:text-brand-100" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </nav>

      {current === "workflow" && <WorkflowMap deal={deal} onOpen={openMilestone} />}
      {current === "plan" && <PlanEditor key={deal.id} deal={deal} />}
      {current === "milestones" && (
        <div className="space-y-4">
          {deal.milestones.map((m) => (
            <div key={m.id} id={`ms-${m.id}`} className="scroll-mt-4">
              <MilestoneCard deal={deal} milestone={m} actions={actions} />
            </div>
          ))}
          <details className="card p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Original agreement</summary>
            <pre className="mt-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-600 dark:text-slate-400">{deal.sourceText}</pre>
          </details>
        </div>
      )}
      {current === "activity" && <DealActivity dealId={deal.id} />}
    </div>
  );
}

/** Share the counterpart's capability key as an invite link. */
function InvitePanel({ dealId }: { dealId: string }) {
  const { toast } = useStore();
  const [open, setOpen] = useState(false);
  const held = keyring.parties(dealId);
  const link = (p: Party) => `${location.origin}/?invite=${encodeURIComponent(keyring.get(dealId, p) ?? "")}`;
  return (
    <div className="relative">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
        <UserPlus className="size-4" /> Invite
      </Button>
      {open && (
        <div className="card absolute right-0 z-20 mt-2 w-80 space-y-3 p-4 text-sm shadow-xl">
          <p className="text-slate-500">Each party gets a signed link. Whoever opens it acts as that party — keep it private.</p>
          {held.map((p) => (
            <div key={p} className="flex items-center justify-between gap-2">
              <span className="font-medium capitalize">{p} link</span>
              <Button
                variant="ghost"
                className="px-2.5 py-1.5"
                onClick={() => navigator.clipboard.writeText(link(p)).then(() => toast(`${p} invite link copied`, "success"))}
              >
                <Copy className="size-3.5" /> Copy
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon, accent = "" }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div className="card p-3 sm:p-4">
      <div className={`flex items-center gap-1.5 text-xs font-medium text-slate-500 ${accent}`}>
        {icon} <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums sm:text-xl">{value}</div>
    </div>
  );
}
