import { useState } from "react";
import { AlarmClock, Ban, CalendarDays, Check, ExternalLink, FileText, Gavel, Link2, ListChecks, Lock, Package, RefreshCw, ScanSearch, Scale, Send, StickyNote } from "lucide-react";
import { milestoneHealth, type Deal, type Milestone, type PendingAction } from "@arko/shared";
import { ExtensionPanel } from "./ExtensionPanel.tsx";
import { api } from "../../lib/api.ts";
import { formatMoney, STEPS, stepIndex } from "../../lib/format.ts";
import { useStore } from "../../lib/store.tsx";
import { Button, Section, StatusBadge } from "../../components/ui.tsx";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { MediationCard, VerificationCard } from "./AiCards.tsx";
import { ProofForm } from "./ProofForm.tsx";

export function MilestoneCard({ deal, milestone: m, actions }: { deal: Deal; milestone: Milestone; actions: PendingAction[] }) {
  const { party, run, busy, upsertDeal, toast } = useStore();
  const [disputeText, setDisputeText] = useState("");
  const step = stepIndex(m.status);
  const k = (s: string) => `${s}-${m.id}`;
  const money = formatMoney(m.amount, deal.currency);
  const terminal = ["released", "settled", "cancelled"].includes(m.status);
  const pending = actions.filter((a) => a.milestoneId === m.id && a.status === "pending");
  const h = milestoneHealth(m, deal.terms);
  const dep = m.dependsOn ? deal.milestones.find((x) => x.id === m.dependsOn) : null;

  const update = (p: Promise<Deal | undefined>) => p.then((d) => d && upsertDeal(d));

  const fund = async () => {
    const res = await run(k("fund"), () => api.fund(deal.id, m.id));
    if (!res) return;
    upsertDeal(res.deal);
    const popup = window.open(res.approveUrl, "paypal", "width=480,height=760");
    if (!popup) location.href = res.approveUrl;
    else toast("Approve the payment in the PayPal window", "info");
  };

  const propose = async (kind: "release" | "cancel" | "split", reason?: string) => {
    await run(k(kind), () => api.propose(deal.id, m.id, kind, reason));
    upsertDeal(await api.deal(deal.id));
  };

  return (
    <article className="card overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">MILESTONE {m.position}</span>
            <StatusBadge status={m.status} />
          </div>
          <h3 className="text-lg font-semibold">{m.title}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">{m.description}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums">{money}</div>
          {m.dueDate && (
            <div className="flex items-center justify-end gap-1 text-xs text-slate-500">
              <CalendarDays className="size-3" /> due {m.dueDate}
              {m.originalDueDate && m.originalDueDate !== m.dueDate && <span className="line-through opacity-60">{m.originalDueDate}</span>}
            </div>
          )}
          <div className="mt-1 flex flex-wrap justify-end gap-1">
            {h.overdue && <span className="chip bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"><AlarmClock className="size-3" /> {h.daysLate}d late</span>}
            {h.reviewDueAt && <span className={`chip ${h.reviewOverdue ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>review by {h.reviewDueAt}</span>}
            {h.holdExpiresInDays !== null && <span className={`chip ${h.holdNeedsRenewal ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"}`}><Lock className="size-3" /> hold {h.holdExpiresInDays}d left</span>}
            {dep && <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Link2 className="size-3" /> after M{dep.position}</span>}
          </div>
        </div>
      </div>

      {/* Progress */}
      <ol className="flex items-center gap-1 px-5 pb-4" aria-label="Milestone progress">
        {STEPS.map((s, i) => {
          const done = i < step || (i === step && terminal);
          const current = i === step && !terminal;
          return (
            <li key={s} className="flex flex-1 flex-col gap-1">
              <div
                className={`h-1.5 rounded-full ${m.status === "cancelled" ? "bg-rose-300 dark:bg-rose-900" : done ? "bg-emerald-500" : current ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-800"}`}
              />
              <span className={`text-[11px] ${current ? "font-semibold text-brand-700 dark:text-brand-100" : "text-slate-400"}`}>{s}</span>
            </li>
          );
        })}
      </ol>

      <div className="space-y-5 border-t border-slate-100 bg-slate-50/50 p-5 dark:border-slate-800 dark:bg-slate-950/30">
        <div className="grid gap-5 md:grid-cols-2">
          <Section title="Deliverables" icon={<Package className="size-3.5" />}>
            {m.deliverables.length ? (
              <ul className="space-y-1">
                {m.deliverables.map((d) => (
                  <li key={d.id} className="flex items-baseline justify-between gap-2 text-sm">
                    <span>{d.name}</span>
                    {d.format && <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{d.format}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Not specified</p>
            )}
          </Section>
          <Section title="Definition of done" icon={<ListChecks className="size-3.5" />}>
            <ul className="space-y-1">
              {m.criteria.map((c) => (
                <li key={c} className="flex gap-2 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-slate-400" /> {c}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        {m.proofs.length > 0 && (
          <Section title="Proof of work">
            <ul className="flex flex-wrap gap-2">
              {m.proofs.map((p) => (
                <li key={p.id} className="chip border border-slate-200 bg-white py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {p.kind === "file" ? <FileText className="size-3.5" /> : p.kind === "link" ? <Link2 className="size-3.5" /> : <StickyNote className="size-3.5" />}
                  {p.kind === "link" && p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer" className="max-w-56 truncate hover:underline">{p.name}</a>
                  ) : (
                    <span className="max-w-56 truncate">{p.name}</span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {m.verification && <VerificationCard v={m.verification} />}
        {m.mediation && <MediationCard m={m.mediation} deal={deal} amount={m.amount} />}

        {pending.map((a) => (
          <ApprovalCard key={a.id} action={a} />
        ))}

        {/* ── Actions by state & role ── */}
        {deal.status !== "proposed" && !terminal && (
          <div className="space-y-3">
            {m.status === "awaiting_funding" &&
              (party === "client" ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="paypal" busy={busy[k("fund")]} onClick={fund}>
                    <Lock className="size-4" /> Hold {money} with PayPal
                  </Button>
                  <span className="text-xs text-slate-500">PayPal reserves the money on your account. Nothing is charged until you approve a release.</span>
                </div>
              ) : (
                <Hint>Waiting for {deal.clientName} to place the PayPal hold.</Hint>
              ))}

            {m.status === "funding_pending" && (
              <div className="flex flex-wrap items-center gap-2">
                <Hint>Waiting for approval in PayPal…</Hint>
                {party === "client" && m.paypal.approveUrl && (
                  <a className="btn-ghost" href={m.paypal.approveUrl} target="paypal">
                    <ExternalLink className="size-4" /> Open PayPal
                  </a>
                )}
                <Button variant="ghost" busy={busy[k("confirm")]} onClick={() => update(run(k("confirm"), () => api.confirmFunding(deal.id, m.id), "Funds held by PayPal"))}>
                  <RefreshCw className="size-4" /> I've approved — check
                </Button>
              </div>
            )}

            {["funded", "submitted", "verified"].includes(m.status) && party === "freelancer" && (
              <Section title={m.proofs.length ? "Add more proof" : "Submit proof of work"} icon={<Send className="size-3.5" />}>
                <ProofForm deal={deal} milestone={m} />
              </Section>
            )}

            {m.status === "funded" && party === "client" && (
              <div className="flex flex-wrap items-center gap-2">
                <Hint>
                  <Lock className="inline size-3.5" /> {money} is held by PayPal. Waiting for {deal.freelancerName}'s proof of work.
                </Hint>
                <Button variant="danger" busy={busy[k("cancel")]} onClick={() => propose("cancel", "Client cancelled before delivery")}>
                  <Ban className="size-4" /> Cancel & return funds
                </Button>
              </div>
            )}

            {["submitted", "verified"].includes(m.status) && (
              <div className="flex flex-wrap gap-2">
                <Button variant={m.verification ? "ghost" : "primary"} busy={busy[k("verify")]} onClick={() => update(run(k("verify"), () => api.verify(deal.id, m.id), "Verifier Agent finished"))}>
                  <ScanSearch className="size-4" /> {busy[k("verify")] ? "Verifier is reviewing the proof…" : m.verification ? "Re-run verification" : "Verify with AI"}
                </Button>
                {party === "client" && m.status === "verified" && !pending.some((a) => a.kind === "release") && (
                  <Button variant="success" busy={busy[k("release")]} onClick={() => propose("release")}>
                    Release {money}
                  </Button>
                )}
              </div>
            )}

            {["funded", "submitted", "verified", "disputed", "mediated"].includes(m.status) && (
              <details className="group rounded-xl border border-slate-200 bg-white p-3 open:pb-4 dark:border-slate-800 dark:bg-slate-900" open={m.status === "disputed"}>
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
                  <Gavel className="size-4 text-amber-600" /> {m.status === "disputed" || m.status === "mediated" ? "Dispute" : "Something's wrong? Raise a dispute"}
                </summary>
                <div className="mt-3 space-y-3">
                  {Object.entries(m.disputeStatements).map(([who, text]) => (
                    <blockquote key={who} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                      <div className="mb-1 text-xs font-semibold text-slate-500 uppercase">{who === "client" ? deal.clientName : deal.freelancerName}</div>
                      {text}
                    </blockquote>
                  ))}
                  <textarea className="input min-h-20" placeholder={`Your side, as the ${party}…`} value={disputeText} onChange={(e) => setDisputeText(e.target.value)} />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="ghost"
                      busy={busy[k("dispute")]}
                      disabled={disputeText.trim().length < 10}
                      onClick={() => update(run(k("dispute"), () => api.dispute(deal.id, m.id, disputeText), "Statement recorded")).then(() => setDisputeText(""))}
                    >
                      Submit my side
                    </Button>
                    {["disputed", "mediated"].includes(m.status) && (
                      <Button busy={busy[k("mediate")]} onClick={() => update(run(k("mediate"), () => api.mediate(deal.id, m.id), "Mediator Agent proposed a split"))}>
                        <Scale className="size-4" /> {busy[k("mediate")] ? "Mediator is weighing both sides…" : m.mediation ? "Ask again" : "Ask the Mediator"}
                      </Button>
                    )}
                  </div>
                </div>
              </details>
            )}

            {m.status === "mediated" && m.mediation && (
              <div className="flex flex-wrap gap-2">
                {!m.mediation.acceptedBy.includes(party) && (
                  <Button variant="ghost" busy={busy[k("accept")]} onClick={() => update(run(k("accept"), () => api.acceptMediation(deal.id, m.id), "You accepted the split"))}>
                    <Check className="size-4" /> Accept split as {party}
                  </Button>
                )}
                {m.mediation.acceptedBy.length === 2 && party === "client" && pending.length === 0 && (
                  <Button variant="success" busy={busy[k("split")]} onClick={() => propose("split")}>
                    Execute split with PayPal
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {deal.status !== "proposed" && !terminal && <ExtensionPanel deal={deal} m={m} />}

        {terminal && <Receipt deal={deal} m={m} />}
      </div>
    </article>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500 dark:text-slate-400">{children}</p>;
}

function Receipt({ deal, m }: { deal: Deal; m: Milestone }) {
  const rows = [
    ["PayPal order", m.paypal.orderId],
    ["Authorization (hold)", m.paypal.authorizationId],
    ["Capture", m.paypal.captureId],
    ["Receipt invoice", m.paypal.invoiceId],
    ["Refund", m.paypal.refundId],
  ].filter(([, v]) => v);
  const title =
    m.status === "released"
      ? `${formatMoney(m.capturedAmount ?? m.amount, deal.currency)} paid to ${deal.freelancerName}`
      : m.status === "settled"
        ? `${formatMoney(m.capturedAmount ?? "0", deal.currency)} paid to ${deal.freelancerName}, rest returned to ${deal.clientName}`
        : `Hold cancelled — ${formatMoney(m.amount, deal.currency)} returned to ${deal.clientName}`;
  return (
    <div className={`rounded-xl p-4 ${m.status === "cancelled" ? "bg-rose-50 dark:bg-rose-950/30" : "bg-emerald-50 dark:bg-emerald-950/30"}`}>
      <div className="text-sm font-semibold">{title}</div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-mono">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
