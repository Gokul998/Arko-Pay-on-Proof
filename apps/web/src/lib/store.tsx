import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Deal, Party, PendingAction } from "@arko/shared";
import { api, ApiError } from "./api.ts";
import { keyring } from "./keyring.ts";

export type View = { name: "new" } | { name: "deal"; id: string; tab?: DealTab } | { name: "ledger" } | { name: "activity" };
export type DealTab = "workflow" | "milestones" | "plan" | "activity";

interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  text: string;
}

interface Store {
  party: Party;
  setParty: (p: Party) => void;
  view: View;
  go: (v: View) => void;
  deals: Deal[];
  actions: PendingAction[];
  refresh: () => Promise<void>;
  upsertDeal: (d: Deal) => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  toasts: Toast[];
  /** Run an async action with loading key + toast on error. */
  run: <T>(key: string, fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
  busy: Record<string, boolean>;
}

const Ctx = createContext<Store | null>(null);

const readView = (): View => {
  const id = new URLSearchParams(location.search).get("deal");
  return id ? { name: "deal", id } : { name: "new" };
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>(() => {
    // Invite link: /?invite=<key> adds the key and opens the deal as that party.
    const invite = new URLSearchParams(location.search).get("invite");
    if (invite) {
      const info = keyring.add(invite);
      if (info) {
        keyring.setParty(info.party);
        history.replaceState(null, "", `/?deal=${info.dealId}`);
        return { name: "deal", id: info.dealId };
      }
    }
    return readView();
  });
  const [party, setPartyState] = useState<Party>(() => keyring.party());
  const [deals, setDeals] = useState<Deal[]>([]);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const refresh = useCallback(async () => {
    const [d, a] = await Promise.all([api.deals(), api.actions()]);
    setDeals(d);
    setActions(a);
  }, []);

  const upsertDeal = useCallback((d: Deal) => {
    setDeals((all) => (all.some((x) => x.id === d.id) ? all.map((x) => (x.id === d.id ? d : x)) : [d, ...all]));
    void api.actions().then(setActions);
  }, []);

  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string) => {
      setBusy((b) => ({ ...b, [key]: true }));
      try {
        const result = await fn();
        if (success) toast(success, "success");
        return result;
      } catch (err) {
        toast(err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong", "error");
        return undefined;
      } finally {
        setBusy((b) => ({ ...b, [key]: false }));
      }
    },
    [toast],
  );

  const setParty = useCallback((p: Party) => {
    keyring.setParty(p);
    setPartyState(p);
  }, []);

  const go = useCallback((v: View) => {
    setView(v);
    const url = v.name === "deal" ? `/?deal=${v.id}` : "/";
    history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    refresh().catch(() => toast("Can't reach the Arko API — is it running?", "error"));
  }, [refresh, toast]);

  // Keep things fresh while a PayPal approval or an AI job may be changing state elsewhere.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.type === "arko:funded") {
        void refresh();
        toast("Funds are now held by PayPal", "success");
      }
    };
    window.addEventListener("message", onMessage);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => {});
    }, 6000);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
  }, [refresh, toast]);

  const value = useMemo(
    () => ({ party, setParty, view, go, deals, actions, refresh, upsertDeal, toast, toasts, run, busy }),
    [party, setParty, view, go, deals, actions, refresh, upsertDeal, toast, toasts, run, busy],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
