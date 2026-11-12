import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api } from "../../lib/api.ts";

/** Landing page PayPal redirects the payer to after approving (or cancelling) the hold. */
export function PayPalReturn({ cancelled }: { cancelled: boolean }) {
  const params = new URLSearchParams(location.search);
  const dealId = params.get("deal") ?? "";
  const milestoneId = params.get("milestone") ?? "";
  const [state, setState] = useState<"working" | "done" | "cancelled" | "error">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const finish = (next: typeof state, msg = "") => {
      setState(next);
      setMessage(msg);
      if (window.opener) {
        window.opener.postMessage({ type: "arko:funded", dealId }, location.origin);
        setTimeout(() => window.close(), 1500);
      } else {
        setTimeout(() => location.replace(`/?deal=${dealId}`), 1500);
      }
    };
    if (cancelled) {
      void api.cancelFunding(dealId, milestoneId).finally(() => finish("cancelled"));
      return;
    }
    api
      .confirmFunding(dealId, milestoneId)
      .then(() => finish("done"))
      .catch((e: Error) => finish("error", e.message));
  }, [cancelled, dealId, milestoneId]);

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="card max-w-sm space-y-3 p-8 text-center">
        {state === "working" && <Loader2 className="mx-auto size-10 animate-spin text-paypal" />}
        {state === "done" && <CheckCircle2 className="mx-auto size-10 text-emerald-600" />}
        {(state === "cancelled" || state === "error") && <XCircle className="mx-auto size-10 text-rose-500" />}
        <h1 className="text-lg font-semibold">
          {state === "working" ? "Placing the hold with PayPal…" : state === "done" ? "Funds are held by PayPal" : state === "cancelled" ? "Funding cancelled" : "Couldn't place the hold"}
        </h1>
        <p className="text-sm text-slate-500">{message || "Returning you to the deal room…"}</p>
      </div>
    </div>
  );
}
