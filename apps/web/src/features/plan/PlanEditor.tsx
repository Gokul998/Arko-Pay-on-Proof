import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  GitBranch,
  History,
  Lightbulb,
  ListChecks,
  Lock,
  Package,
  Plus,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { fromCents, toCents, type Deal, type MilestoneDraft, type PaymentTerms } from "@arko/shared";
import { api, ApiError } from "../../lib/api.ts";
import { formatMoney, timeAgo } from "../../lib/format.ts";
import { useStore } from "../../lib/store.tsx";
import { Button, Section } from "../../components/ui.tsx";

type Draft = Omit<MilestoneDraft, "deliverables"> & { deliverables: Array<{ name: string; format: string; notes: string }> };

const toDrafts = (deal: Deal): Draft[] =>
  deal.milestones.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    amount: m.amount,
    dueDate: m.dueDate,
    criteria: [...m.criteria],
    deliverables: m.deliverables.map((d) => ({ name: d.name, format: d.format, notes: d.notes })),
    dependsOnIndex: m.dependsOn ? deal.milestones.findIndex((x) => x.id === m.dependsOn) : null,
  }));

/**
 * Negotiation stage: both parties shape the milestone plan — split-up, amounts, due dates,
 * deliverables, definition of done and payment terms. Every save is a new version; both
 * parties must accept the *same* version before any money is held.
 */
export function PlanEditor({ deal }: { deal: Deal }) {
  const { party, run, busy, upsertDeal, toast } = useStore();
  const locked = deal.status !== "proposed";
  const [title, setTitle] = useState(deal.title);
  const [summary, setSummary] = useState(deal.summary);
  const [terms, setTerms] = useState<PaymentTerms>(deal.terms);
  const [items, setItems] = useState<Draft[]>(() => toDrafts(deal));
  const [baseVersion, setBaseVersion] = useState(deal.version);

  // Pull in the other party's revision when nothing is being edited locally.
  const dirty = useMemo(
    () => JSON.stringify({ title, summary, terms, items }) !== JSON.stringify({ title: deal.title, summary: deal.summary, terms: deal.terms, items: toDrafts(deal) }),
    [title, summary, terms, items, deal],
  );
  useEffect(() => {
    if (!dirty && deal.version !== baseVersion) {
      setTitle(deal.title);
      setSummary(deal.summary);
      setTerms(deal.terms);
      setItems(toDrafts(deal));
      setBaseVersion(deal.version);
    }
  }, [deal, dirty, baseVersion]);

  const total = fromCents(items.reduce((t, m) => t + toCents(m.amount || "0"), 0));
  const patch = (i: number, p: Partial<Draft>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, dir: -1 | 1) =>
    setItems((xs) => {
      const j = i + dir;
      if (j < 0 || j >= xs.length) return xs;
      const next = xs.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      // dependencies must point backwards; clear any that no longer do
      return next.map((x, k) => ({ ...x, dependsOnIndex: x.dependsOnIndex !== null && x.dependsOnIndex >= k ? null : x.dependsOnIndex }));
    });

  const save = async () => {
    const updated = await run(
      "plan-save",
      async () => {
        try {
          return await api.updatePlan(deal.id, {
            expectedVersion: deal.version,
            title,
            summary,
            terms,
            milestones: items.map((m) => ({ ...m, criteria: m.criteria.filter((c) => c.trim()), deliverables: m.deliverables.filter((d) => d.name.trim()) })),
          });
        } catch (e) {
          if (e instanceof ApiError && e.code === "VERSION_CONFLICT") toast("The other party saved a newer version — your edits are kept; review and save again.", "error");
          throw e;
        }
      },
      "Saved as a new version — waiting for the other party",
    );
    if (updated) {
      upsertDeal(updated);
      setBaseVersion(updated.version);
    }
  };

  const review = deal.planReview;
  const reviewStale = review && review.version !== deal.version;

  return (
    <div className="grid gap-6 2xl:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        {locked && (
          <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm dark:bg-slate-800/60">
            <Lock className="size-4" /> Plan v{deal.version} was accepted by both parties and is locked. Due dates can still move through extension requests.
          </div>
        )}

        {/* Deal header */}
        <div className="card space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="label">Project</label>
              <input className="input text-base font-semibold" value={title} disabled={locked} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="text-right">
              <label className="label">Plan total</label>
              <div className="pt-1 text-2xl font-bold tabular-nums">{formatMoney(total, deal.currency)}</div>
            </div>
          </div>
          <div>
            <label className="label">Scope summary</label>
            <textarea className="input min-h-16" value={summary} disabled={locked} onChange={(e) => setSummary(e.target.value)} />
          </div>
        </div>

        {/* Milestones */}
        <Section title={`Milestone plan · ${items.length} milestones`} icon={<GitBranch className="size-3.5" />}>
          <div className="space-y-3">
            {items.map((m, i) => (
              <div key={m.id ?? `new-${i}`} className="card overflow-hidden">
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 dark:border-slate-800 dark:bg-slate-950/30">
                  <span className="grid size-6 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
                  <input className="flex-1 bg-transparent text-sm font-semibold focus:outline-none" value={m.title} disabled={locked} onChange={(e) => patch(i, { title: e.target.value })} placeholder="Milestone title" />
                  {!locked && (
                    <div className="flex items-center gap-0.5 text-slate-400">
                      <IconBtn label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="size-4" /></IconBtn>
                      <IconBtn label="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1}><ArrowDown className="size-4" /></IconBtn>
                      <IconBtn label="Remove milestone" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i).map((x) => ({ ...x, dependsOnIndex: x.dependsOnIndex === i ? null : x.dependsOnIndex !== null && x.dependsOnIndex > i ? x.dependsOnIndex - 1 : x.dependsOnIndex })))} disabled={items.length === 1}>
                        <Trash2 className="size-4" />
                      </IconBtn>
                    </div>
                  )}
                </div>
                <div className="grid gap-4 p-4 xl:grid-cols-2">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Amount ({deal.currency})</label>
                        <input className="input tabular-nums" inputMode="decimal" value={m.amount} disabled={locked} onChange={(e) => patch(i, { amount: e.target.value.replace(/[^\d.]/g, "") })} />
                      </div>
                      <div>
                        <label className="label">Due date</label>
                        <input type="date" className="input" value={m.dueDate ?? ""} disabled={locked} onChange={(e) => patch(i, { dueDate: e.target.value || null })} />
                      </div>
                    </div>
                    <div>
                      <label className="label">Starts after</label>
                      <select className="input" value={m.dependsOnIndex ?? ""} disabled={locked || i === 0} onChange={(e) => patch(i, { dependsOnIndex: e.target.value === "" ? null : Number(e.target.value) })}>
                        <option value="">Can start right away</option>
                        {items.slice(0, i).map((x, j) => (
                          <option key={j} value={j}>{j + 1}. {x.title || "Untitled"} is done</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Specification</label>
                      <textarea className="input min-h-20" value={m.description} disabled={locked} onChange={(e) => patch(i, { description: e.target.value })} placeholder="What exactly is in scope?" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <ListEditor
                      icon={<Package className="size-3.5" />}
                      title="Deliverables"
                      locked={locked}
                      rows={m.deliverables}
                      empty={{ name: "", format: "", notes: "" }}
                      onChange={(rows) => patch(i, { deliverables: rows })}
                      render={(row, set) => (
                        <div className="grid flex-1 grid-cols-[1fr_120px] gap-2">
                          <input className="input py-1.5" placeholder="e.g. Final logo files" value={row.name} disabled={locked} onChange={(e) => set({ ...row, name: e.target.value })} />
                          <input className="input py-1.5" placeholder="Format" value={row.format} disabled={locked} onChange={(e) => set({ ...row, format: e.target.value })} />
                        </div>
                      )}
                    />
                    <ListEditor
                      icon={<ListChecks className="size-3.5" />}
                      title="Definition of done"
                      locked={locked}
                      rows={m.criteria}
                      empty=""
                      onChange={(rows) => patch(i, { criteria: rows })}
                      render={(row, set) => (
                        <input className="input flex-1 py-1.5" placeholder="Objective, checkable — e.g. 'Delivered as SVG and transparent PNG'" value={row} disabled={locked} onChange={(e) => set(e.target.value)} />
                      )}
                    />
                  </div>
                </div>
              </div>
            ))}
            {!locked && (
              <button
                className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 py-3 text-sm font-semibold text-slate-500 hover:border-brand-500 hover:text-brand-600 dark:border-slate-700"
                onClick={() =>
                  setItems((xs) => [...xs, { title: "", description: "", amount: "100.00", dueDate: null, criteria: [""], deliverables: [{ name: "", format: "", notes: "" }], dependsOnIndex: xs.length ? xs.length - 1 : null }])
                }
              >
                <Plus className="size-4" /> Add milestone
              </button>
            )}
          </div>
        </Section>

        {/* Payment terms */}
        <Section title="Payment & delivery terms" icon={<FileCheck2 className="size-3.5" />}>
          <div className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">Funding</label>
              <select className="input" value={terms.fundingSchedule} disabled={locked} onChange={(e) => setTerms({ ...terms, fundingSchedule: e.target.value as PaymentTerms["fundingSchedule"] })}>
                <option value="per_milestone">Per milestone</option>
                <option value="all_upfront">All upfront</option>
              </select>
            </div>
            <NumberField label="Review window (days)" value={terms.reviewWindowDays} min={1} max={30} locked={locked} onChange={(v) => setTerms({ ...terms, reviewWindowDays: v })} />
            <NumberField label="Revision rounds" value={terms.revisionRounds} min={0} max={10} locked={locked} onChange={(v) => setTerms({ ...terms, revisionRounds: v })} />
            <NumberField label="Max extension (days)" value={terms.maxExtensionDays} min={0} max={60} locked={locked} onChange={(v) => setTerms({ ...terms, maxExtensionDays: v })} />
            <div className="sm:col-span-2">
              <label className="label">Late delivery</label>
              <textarea className="input min-h-14" value={terms.lateDeliveryPolicy} disabled={locked} onChange={(e) => setTerms({ ...terms, lateDeliveryPolicy: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Cancellation</label>
              <textarea className="input min-h-14" value={terms.cancellationPolicy} disabled={locked} onChange={(e) => setTerms({ ...terms, cancellationPolicy: e.target.value })} />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <label className="label">Other terms</label>
              <input className="input" value={terms.notes} disabled={locked} onChange={(e) => setTerms({ ...terms, notes: e.target.value })} placeholder="e.g. Source files included; usage rights transfer on final payment" />
            </div>
          </div>
        </Section>

        {!locked && (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
            <span className="text-sm text-slate-500">
              {dirty ? `Unsaved changes — saving creates v${deal.version + 1} and asks the other party to re-approve.` : `You're viewing v${deal.version}.`}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={!dirty} onClick={() => (setTitle(deal.title), setSummary(deal.summary), setTerms(deal.terms), setItems(toDrafts(deal)))}>
                Discard
              </Button>
              <Button busy={busy["plan-save"]} disabled={!dirty} onClick={save}>
                <Save className="size-4" /> Save as v{deal.version + 1} as {party}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Right rail: AI review + history */}
      <div className="space-y-4">
        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardCheck className="size-4 text-brand-600" /> AI plan review
            </h3>
            {review && <span className={`text-xl font-bold tabular-nums ${review.readiness >= 80 ? "text-emerald-600" : review.readiness >= 60 ? "text-amber-600" : "text-rose-600"}`}>{review.readiness}</span>}
          </div>
          {review ? (
            <>
              {reviewStale && <p className="text-xs text-amber-600">Reviewed v{review.version} — the plan has changed since.</p>}
              <p className="text-sm text-slate-600 dark:text-slate-400">{review.summary}</p>
              <ul className="space-y-2">
                {review.issues.map((x, i) => (
                  <li key={i} className="rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800/50">
                    <div className="flex items-center gap-1.5 font-semibold">
                      {x.severity === "blocker" ? <ShieldAlert className="size-3.5 text-rose-500" /> : x.severity === "warning" ? <AlertTriangle className="size-3.5 text-amber-500" /> : <Lightbulb className="size-3.5 text-sky-500" />}
                      {x.milestone ?? "Whole plan"}
                    </div>
                    <p className="mt-1">{x.message}</p>
                    <p className="mt-1 text-slate-500">→ {x.suggestion}</p>
                  </li>
                ))}
                {review.issues.length === 0 && (
                  <li className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="size-4" /> No issues found</li>
                )}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-500">Checks that every definition-of-done item is testable, deliverables have formats, amounts add up and dates are realistic — before anyone funds.</p>
          )}
          {!locked && (
            <Button variant="ghost" className="w-full" busy={busy["plan-review"]} onClick={() => run("plan-review", () => api.reviewPlan(deal.id), "Plan reviewed").then((d) => d && upsertDeal(d))}>
              <Sparkles className="size-4" /> {busy["plan-review"] ? "Reviewing plan…" : review ? `Review v${deal.version} again` : "Review this plan"}
            </Button>
          )}
        </div>

        <div className="card space-y-3 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4 text-brand-600" /> Version history</h3>
          <ol className="relative space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700">
            {[...deal.revisions].reverse().map((r) => (
              <li key={r.version} className="text-xs">
                <span className={`absolute -left-1.5 mt-1 size-3 rounded-full ring-4 ring-white dark:ring-slate-900 ${r.version === deal.version ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"}`} />
                <div className="font-semibold">
                  v{r.version} · {r.editedBy === "contract-agent" ? "Contract Agent" : r.editedBy} <span className="font-normal text-slate-400">{timeAgo(r.createdAt)}</span>
                </div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-500">
                  {r.changes.slice(0, 6).map((c, i) => <li key={i}>{c}</li>)}
                </ul>
                {r.version === deal.version && (
                  <div className="mt-1 text-slate-500">Accepted by: {deal.acceptedBy.length ? deal.acceptedBy.join(" & ") : "no one yet"}</div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function ListEditor<T>({ icon, title, rows, empty, locked, onChange, render }: { icon: React.ReactNode; title: string; rows: T[]; empty: T; locked: boolean; onChange: (rows: T[]) => void; render: (row: T, set: (row: T) => void) => React.ReactNode }) {
  return (
    <div>
      <div className="label flex items-center gap-1.5">{icon} {title}</div>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {render(row, (r) => onChange(rows.map((x, j) => (j === i ? r : x))))}
            {!locked && <IconBtn label={`Remove ${title.toLowerCase()} item`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></IconBtn>}
          </div>
        ))}
        {!locked && (
          <button className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline" onClick={() => onChange([...rows, empty])}>
            <Plus className="size-3.5" /> Add
          </button>
        )}
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, locked, onChange }: { label: string; value: number; min: number; max: number; locked: boolean; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="number" className="input tabular-nums" min={min} max={max} value={value} disabled={locked} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))} />
    </div>
  );
}

function IconBtn({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...props} aria-label={label} title={label} className="rounded-lg p-1.5 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200">
      {children}
    </button>
  );
}
