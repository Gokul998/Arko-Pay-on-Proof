import { useEffect, useState } from "react";
import { Activity as ActivityIcon, Bot, CreditCard, Scale, ScanSearch, User } from "lucide-react";
import type { AuditEvent } from "@arko/shared";
import { api } from "../../lib/api.ts";
import { timeAgo } from "../../lib/format.ts";
import { useStore } from "../../lib/store.tsx";
import { Empty } from "../../components/ui.tsx";

const ICON: Record<string, React.ReactNode> = {
  paypal: <CreditCard className="size-4 text-paypal" />,
  "verifier-agent": <ScanSearch className="size-4 text-teal-600" />,
  "mediator-agent": <Scale className="size-4 text-orange-600" />,
  "contract-agent": <Bot className="size-4 text-brand-600" />,
  "plan-reviewer": <Bot className="size-4 text-violet-600" />,
  arko: <Bot className="size-4 text-brand-600" />,
};

const useEvents = (dealId?: string) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  useEffect(() => {
    const load = () => void api.activity(dealId).then(setEvents).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [dealId]);
  return events;
};

export function DealActivity({ dealId }: { dealId: string }) {
  const events = useEvents(dealId);
  return events.length === 0 ? <Empty icon={<ActivityIcon className="size-6" />} title="Nothing yet" /> : <EventList events={events} />;
}

function EventList({ events, showDeal = false }: { events: AuditEvent[]; showDeal?: boolean }) {
  const { deals, go } = useStore();
  return (
    <ol className="card divide-y divide-slate-100 dark:divide-slate-800">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 p-4">
          <div className="mt-0.5">{ICON[e.actor] ?? <User className="size-4 text-slate-400" />}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm">{e.message}</p>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
              <span className="font-medium">{e.actor}</span>
              <span className="font-mono">{e.type}</span>
              {showDeal && e.dealId && (
                <button className="text-brand-600 hover:underline" onClick={() => go({ name: "deal", id: e.dealId!, tab: "activity" })}>
                  {deals.find((d) => d.id === e.dealId)?.title ?? e.dealId}
                </button>
              )}
            </div>
          </div>
          <time className="shrink-0 text-xs text-slate-400" dateTime={e.createdAt}>
            {timeAgo(e.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}

/** Audit trail of every agent decision, approval and PayPal response. */
export function Activity() {
  const events = useEvents();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <ActivityIcon className="size-6 text-brand-600" /> Audit trail
      </h1>
      <p className="text-sm text-slate-500">Every AI decision, human approval and PayPal response — so either party can see exactly what happened.</p>
      {events.length === 0 ? <Empty icon={<ActivityIcon className="size-6" />} title="Nothing yet" /> : <EventList events={events} showDeal />}
    </div>
  );
}
