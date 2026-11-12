import { useEffect, useState } from "react";
import { Activity as ActivityIcon, BriefcaseBusiness, CircleUserRound, Menu, MessageCircle, Plus, Table2, X } from "lucide-react";
import type { Party } from "@arko/shared";
import { api } from "./lib/api.ts";
import { keyring } from "./lib/keyring.ts";
import { formatMoney } from "./lib/format.ts";
import { useStore } from "./lib/store.tsx";
import { StatusBadge } from "./components/ui.tsx";
import { NewDeal } from "./features/deals/NewDeal.tsx";
import { DealRoom } from "./features/deals/DealRoom.tsx";
import { Ledger } from "./features/ledger/Ledger.tsx";
import { Activity } from "./features/activity/Activity.tsx";
import { ChatPanel } from "./features/chat/ChatPanel.tsx";

export function App() {
  const { view, go, deals, party, setParty, toasts } = useStore();
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth >= 1280);
  const [navOpen, setNavOpen] = useState(false);
  const [health, setHealth] = useState<{ paypal: string; claude: string; environment: string } | null>(null);

  useEffect(() => {
    void api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const nav = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <button className="btn-primary mb-3 w-full" onClick={() => (go({ name: "new" }), setNavOpen(false))}>
        <Plus className="size-4" /> New deal
      </button>
      <NavItem active={view.name === "ledger"} icon={<Table2 className="size-4" />} label="Escrow ledger" onClick={() => (go({ name: "ledger" }), setNavOpen(false))} />
      <NavItem active={view.name === "activity"} icon={<ActivityIcon className="size-4" />} label="Audit trail" onClick={() => (go({ name: "activity" }), setNavOpen(false))} />
      <div className="mt-4 mb-1 px-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Deals</div>
      <div className="-mx-1 flex-1 space-y-1 overflow-y-auto px-1">
        {deals.length === 0 && <p className="px-2 text-sm text-slate-400">No deals yet.</p>}
        {deals.map((d) => {
          const total = d.milestones.reduce((t, m) => t + Number(m.amount), 0);
          const active = view.name === "deal" && view.id === d.id;
          const current = d.milestones.find((m) => !["released", "settled", "cancelled"].includes(m.status)) ?? d.milestones[d.milestones.length - 1];
          return (
            <button
              key={d.id}
              onClick={() => (go({ name: "deal", id: d.id }), setNavOpen(false))}
              className={`w-full rounded-xl p-2.5 text-left transition ${active ? "bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-600/10 dark:ring-brand-600/30" : "hover:bg-slate-100 dark:hover:bg-slate-800/60"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{d.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">{formatMoney(total, d.currency)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span className="truncate">{d.freelancerName}</span>
                {d.status === "proposed" ? <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800">Terms</span> : current && <StatusBadge status={current.status} />}
              </div>
            </button>
          );
        })}
      </div>
      {health && (
        <div className="mt-2 space-y-1 rounded-xl bg-slate-100 p-2.5 text-xs dark:bg-slate-800/60">
          <Dot ok={health.paypal === "configured"} label={`PayPal ${health.environment}`} />
          <Dot ok={health.claude === "configured"} label="Claude agents" />
        </div>
      )}
    </nav>
  );

  return (
    <div className="flex h-dvh flex-col">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 sm:px-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <button onClick={() => go({ name: "new" })} className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="hidden font-bold tracking-tight min-[380px]:inline">Arko</span>
            <span className="hidden text-sm text-slate-400 sm:inline">Pay-on-Proof</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <RoleSwitch party={party} setParty={setParty} allowed={view.name === "deal" ? keyring.parties(view.id) : ["client", "freelancer"]} />
          <button className={`btn-ghost px-3 ${chatOpen ? "ring-2 ring-brand-500/30" : ""}`} onClick={() => setChatOpen((o) => !o)} aria-label="Toggle Arko chat">
            <MessageCircle className="size-4" /> <span className="hidden sm:inline">Ask Arko</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900">{nav}</aside>
        {navOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setNavOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl dark:bg-slate-900">
              <button className="absolute top-3 right-3 rounded-lg p-1.5" onClick={() => setNavOpen(false)} aria-label="Close menu">
                <X className="size-4" />
              </button>
              <div className="pt-10 h-full">{nav}</div>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">
          {view.name === "new" && <NewDeal />}
          {view.name === "deal" && <DealRoom id={view.id} tab={view.tab} />}
          {view.name === "ledger" && <Ledger />}
          {view.name === "activity" && <Activity />}
        </main>

        {chatOpen && (
          <div className="fixed inset-0 z-30 border-l border-slate-200 sm:static sm:inset-auto sm:z-auto sm:w-96 sm:shrink-0 dark:border-slate-800">
            <ChatPanel onClose={() => setChatOpen(false)} />
          </div>
        )}
      </div>

      {/* Toasts */}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-sm rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
              t.tone === "error" ? "bg-rose-600 text-white" : t.tone === "success" ? "bg-emerald-600 text-white" : "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleSwitch({ party, setParty, allowed }: { party: Party; setParty: (p: Party) => void; allowed: Party[] }) {
  return (
    <div className="flex items-center rounded-xl bg-slate-100 p-1 text-xs font-semibold dark:bg-slate-800" role="radiogroup" aria-label="Acting as">
      {(["client", "freelancer"] as const).map((p) => (
        <button
          key={p}
          role="radio"
          aria-checked={party === p}
          disabled={!allowed.includes(p)}
          title={allowed.includes(p) ? `Act as ${p}` : `You don't hold the ${p} key for this deal`}
          onClick={() => setParty(p)}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 capitalize ${party === p ? "bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-brand-100" : "text-slate-500"}`}
        >
          {p === "client" ? <CircleUserRound className="size-3.5" /> : <BriefcaseBusiness className="size-3.5" />}
          <span className="hidden min-[420px]:inline">{p}</span>
        </button>
      ))}
    </div>
  );
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium ${active ? "bg-slate-100 dark:bg-slate-800" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60"}`}>
      {icon} {label}
    </button>
  );
}

const Dot = ({ ok, label }: { ok: boolean; label: string }) => (
  <div className="flex items-center gap-2">
    <span className={`size-2 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`} />
    <span className="text-slate-600 dark:text-slate-300">{label}</span>
    {!ok && <span className="text-rose-600">not configured</span>}
  </div>
);
