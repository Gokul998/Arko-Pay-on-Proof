import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileImage, FileText, FileType2, Loader2, Mail, ShieldCheck, Sparkles, UploadCloud, Wand2, X } from "lucide-react";
import type { Currency, SourceDocument } from "@arko/shared";
import { api, fileToBase64 } from "../../lib/api.ts";
import { keyring } from "../../lib/keyring.ts";
import { useStore } from "../../lib/store.tsx";
import { Button } from "../../components/ui.tsx";
import { SAMPLES } from "./samples.ts";

const ACCEPT = ".pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.html,.htm,.eml,.rtf,.csv,.json";
const MAX_BYTES = 10 * 1024 * 1024;

/** The AI pipeline the Contract Agent runs — shown while it works. */
const PIPELINE = [
  "Reading the statement of work",
  "Extracting scope, amounts & payment schedule",
  "Splitting into milestones",
  "Writing deliverables & definition of done",
  "Preparing v1 for both parties to approve",
];

const fileIcon = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return <FileImage className="size-5" />;
  if (ext === "eml") return <Mail className="size-5" />;
  if (ext === "pdf" || ext === "docx") return <FileType2 className="size-5" />;
  return <FileText className="size-5" />;
};

export function NewDeal() {
  const { run, busy, upsertDeal, go, toast } = useStore();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [drag, setDrag] = useState(false);
  const [clientName, setClientName] = useState("");
  const [freelancerName, setFreelancerName] = useState("");
  const [currency, setCurrency] = useState<Currency | "">("");
  const [stage, setStage] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const working = !!busy.create;

  useEffect(() => {
    if (!working) return setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(PIPELINE.length - 1, s + 1)), 4500);
    return () => clearInterval(t);
  }, [working]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) return toast("That file is over 10 MB", "error");
    setFile(f);
    setMode("upload");
  };

  const ready = mode === "upload" ? !!file : text.trim().length >= 20;

  const submit = async () => {
    const document: SourceDocument | undefined =
      mode === "upload" && file ? { name: file.name, mimeType: file.type || "application/octet-stream", dataBase64: await fileToBase64(file) } : undefined;
    const created = await run("create", () =>
      api.createDeal({
        document,
        text: mode === "paste" ? text : undefined,
        clientName: clientName || undefined,
        freelancerName: freelancerName || undefined,
        currency: currency || undefined,
      }),
    );
    if (created) {
      keyring.add(created.keys.client);
      keyring.add(created.keys.freelancer);
      upsertDeal(created.deal);
      go({ name: "deal", id: created.deal.id, tab: "plan" });
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 sm:p-8">
      <header className="space-y-3">
        <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-100">
          <Sparkles className="size-3.5" /> AI escrow on PayPal
        </span>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Drop a SOW. Get paid on proof.</h1>
        <p className="max-w-2xl text-slate-600 dark:text-slate-400">
          Upload any statement of work or work order. Arko's agents split it into milestones with deliverables and a definition of done, both
          sides approve, PayPal holds the money — and it's released only when the work is proven.
        </p>
      </header>

      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-500 via-violet-500 to-sky-500 p-[1.5px] shadow-xl shadow-brand-500/10">
        <div className="space-y-5 rounded-[calc(1.5rem-1.5px)] bg-white p-5 sm:p-7 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-xl bg-slate-100 p-1 text-sm font-semibold dark:bg-slate-800">
              {(["upload", "paste"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 ${mode === m ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500"}`}>
                  {m === "upload" ? "Upload SOW" : "Paste text"}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.label}
                  className="chip border border-slate-200 bg-white text-slate-600 hover:border-brand-500 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  onClick={() => {
                    setMode("paste");
                    setText(s.text);
                    setClientName(s.clientName);
                    setFreelancerName(s.freelancerName);
                  }}
                >
                  Try: {s.label}
                </button>
              ))}
            </div>
          </div>

          {working ? (
            <div className="grid gap-6 rounded-2xl bg-slate-50 p-6 sm:grid-cols-[auto_1fr] dark:bg-slate-950/60">
              <div className="relative mx-auto grid size-24 place-items-center">
                <div className="absolute inset-0 animate-spin rounded-full border-4 border-brand-500/20 border-t-brand-500 [animation-duration:1.4s]" />
                <Wand2 className="size-8 text-brand-600" />
              </div>
              <ol className="space-y-2.5">
                {PIPELINE.map((p, i) => (
                  <li key={p} className={`flex items-center gap-2.5 text-sm ${i > stage ? "text-slate-400" : ""}`}>
                    {i < stage ? <CheckCircle2 className="size-4 text-emerald-500" /> : i === stage ? <Loader2 className="size-4 animate-spin text-brand-600" /> : <span className="size-4 rounded-full border-2 border-slate-300 dark:border-slate-700" />}
                    <span className={i === stage ? "font-semibold" : ""}>{p}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : mode === "upload" ? (
            <div
              onDragOver={(e) => (e.preventDefault(), setDrag(true))}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                pick(e.dataTransfer.files[0]);
              }}
              onClick={() => input.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
              className={`group flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${drag ? "border-brand-500 bg-brand-50 dark:bg-brand-600/10" : "border-slate-300 hover:border-brand-400 dark:border-slate-700"}`}
            >
              <input ref={input} type="file" hidden accept={ACCEPT} onChange={(e) => pick(e.target.files?.[0])} />
              {file ? (
                <div className="flex items-center gap-3 rounded-xl bg-slate-100 px-4 py-3 dark:bg-slate-800">
                  <span className="text-brand-600">{fileIcon(file.name)}</span>
                  <div className="text-left">
                    <div className="max-w-64 truncate text-sm font-semibold">{file.name}</div>
                    <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB · ready for the Contract Agent</div>
                  </div>
                  <button className="rounded-lg p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700" onClick={(e) => (e.stopPropagation(), setFile(null))} aria-label="Remove file">
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 transition group-hover:scale-110 dark:bg-brand-600/15">
                    <UploadCloud className="size-7" />
                  </div>
                  <div>
                    <div className="font-semibold">Drop your SOW or work order here</div>
                    <div className="text-sm text-slate-500">PDF · Word · scanned image · email · text / Markdown / HTML — up to 10 MB</div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <textarea
              className="input min-h-56 font-mono text-[13px] leading-relaxed"
              placeholder="Paste the SOW, email or chat where the work and price were agreed…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="client">Client (payer)</label>
              <input id="client" className="input" placeholder="Detected by AI" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="freelancer">Freelancer (payee)</label>
              <input id="freelancer" className="input" placeholder="Detected by AI" value={freelancerName} onChange={(e) => setFreelancerName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="currency">Currency</label>
              <select id="currency" className="input" value={currency} onChange={(e) => setCurrency(e.target.value as Currency | "")}>
                <option value="">Detect from SOW</option>
                {["USD", "EUR", "GBP", "AUD", "CAD"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="size-4 text-emerald-600" /> The AI only proposes the split — both parties review and approve before any money is held.
            </p>
            <Button busy={working} disabled={!ready} onClick={submit}>
              <Wand2 className="size-4" /> {working ? "Contract Agent at work…" : "Split into milestones with AI"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
