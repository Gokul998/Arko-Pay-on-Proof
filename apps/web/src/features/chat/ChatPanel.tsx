import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { Bot, CheckCircle2, Loader2, Mic, MicOff, SendHorizonal, Sparkles, Wrench, X, XCircle } from "lucide-react";
import type { ChatEvent, PendingAction } from "@arko/shared";
import { streamChat } from "../../lib/api.ts";
import { useStore } from "../../lib/store.tsx";
import { ApprovalCard } from "../deals/ApprovalCard.tsx";

type Part =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; status: "running" | "done" | "error"; summary?: string }
  | { kind: "approval"; action: PendingAction };

interface Msg {
  role: "user" | "assistant";
  parts: Part[];
}

const TOOL_LABEL: Record<string, string> = {
  list_deals: "Reading your deals",
  get_deal: "Opening the deal",
  check_paypal_hold: "Checking PayPal via MCP",
  verify_milestone: "Running the Verifier Agent",
  propose_payment_action: "Preparing an approval",
};

const SUGGESTIONS = {
  client: ["What's held in escrow right now?", "Has the work for milestone 1 been verified?", "Release milestone 1 if it passed"],
  freelancer: ["When will I get paid?", "Is the client's money really held by PayPal?", "What do I still need to deliver?"],
};

// Minimal typing for the Web Speech API (not in TS DOM lib everywhere).
type SpeechRec = { start: () => void; stop: () => void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; lang: string; interimResults: boolean };

export function ChatPanel({ onClose }: { onClose?: () => void }) {
  const { party, view, actions, refresh } = useStore();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [listening, setListening] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const dealId = view.name === "deal" ? view.id : undefined;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || streaming) return;
    const history = messages.map((m) => ({
      role: m.role,
      content: m.parts.map((p) => (p.kind === "text" ? p.text : "")).join("").trim() || "(used tools)",
    }));
    setMessages((ms) => [...ms, { role: "user", parts: [{ kind: "text", text }] }, { role: "assistant", parts: [] }]);
    setInput("");
    setStreaming(true);

    const apply = (e: ChatEvent) =>
      setMessages((ms) => {
        const copy = ms.slice();
        const last = { ...copy[copy.length - 1]!, parts: copy[copy.length - 1]!.parts.slice() };
        copy[copy.length - 1] = last;
        const tail = last.parts[last.parts.length - 1];
        if (e.type === "text") {
          if (tail?.kind === "text") last.parts[last.parts.length - 1] = { ...tail, text: tail.text + e.delta };
          else last.parts.push({ kind: "text", text: e.delta });
        } else if (e.type === "tool") {
          const i = last.parts.findIndex((p) => p.kind === "tool" && p.id === e.id);
          const part: Part = { kind: "tool", id: e.id, name: e.name, status: e.status, summary: e.summary };
          if (i >= 0) last.parts[i] = part;
          else last.parts.push(part);
        } else if (e.type === "approval") {
          last.parts.push({ kind: "approval", action: e.action });
        } else if (e.type === "error") {
          last.parts.push({ kind: "text", text: `\n\n⚠️ ${e.message}` });
        }
        return copy;
      });

    try {
      await streamChat({ message: text, dealId, party, history }, apply);
    } catch {
      apply({ type: "error", message: "Connection to Arko was lost" });
    } finally {
      setStreaming(false);
      void refresh();
    }
  };

  const toggleMic = () => {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Rec = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Rec) return alert("Voice input isn't supported in this browser.");
    if (listening) return recRef.current?.stop();
    const rec = new Rec();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0]?.transcript ?? "").join(" ");
      void send(said);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  // Keep approval cards in the chat in sync with the latest server state.
  const live = (a: PendingAction) => actions.find((x) => x.id === a.id) ?? a;

  return (
    <aside className="flex h-full flex-col bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white">
            <Sparkles className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Arko</div>
            <div className="text-xs text-slate-500">Escrow agent · PayPal via MCP</div>
          </div>
        </div>
        {onClose && (
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose} aria-label="Close chat">
            <X className="size-4" />
          </button>
        )}
      </div>

      <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="space-y-3 pt-6 text-center">
            <Bot className="mx-auto size-8 text-brand-500" />
            <p className="text-sm text-slate-500">
              Ask about holds, proof and payouts. I can check PayPal live and prepare releases —{" "}
              <b>you always approve the money move.</b>
            </p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS[party].map((s) => (
                <button key={s} onClick={() => void send(s)} className="rounded-xl border border-slate-200 px-3 py-2 text-left text-sm hover:border-brand-500 dark:border-slate-700">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-8 rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm text-white">
              {m.parts.map((p) => (p.kind === "text" ? p.text : "")).join("")}
            </div>
          ) : (
            <div key={i} className="mr-4 space-y-2">
              {m.parts.length === 0 && streaming && <Loader2 className="size-4 animate-spin text-slate-400" />}
              {m.parts.map((p, j) =>
                p.kind === "text" ? (
                  <div key={j} className="prose-chat text-sm leading-relaxed">
                    <Markdown>{p.text}</Markdown>
                  </div>
                ) : p.kind === "tool" ? (
                  <div key={j} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                    {p.status === "running" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : p.status === "done" ? (
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                    ) : (
                      <XCircle className="size-3.5 text-rose-500" />
                    )}
                    <Wrench className="size-3 text-slate-400" />
                    <span className="font-medium">{TOOL_LABEL[p.name] ?? p.name}</span>
                    {p.summary && <span className="truncate text-slate-400">· {p.summary}</span>}
                  </div>
                ) : (
                  <ApprovalCard key={j} action={live(p.action)} compact />
                ),
              )}
            </div>
          ),
        )}
      </div>

      <form
        className="border-t border-slate-200 p-3 dark:border-slate-800"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 focus-within:border-brand-500 dark:border-slate-700 dark:bg-slate-950">
          <button
            type="button"
            onClick={toggleMic}
            className={`rounded-xl p-2 ${listening ? "bg-rose-100 text-rose-600 dark:bg-rose-950" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            aria-label={listening ? "Stop voice input" : "Speak to Arko"}
          >
            {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={`Ask Arko as the ${party}…`}
            className="max-h-32 flex-1 resize-none bg-transparent px-1 py-2 text-sm focus:outline-none"
          />
          <button type="submit" disabled={!input.trim() || streaming} className="rounded-xl bg-brand-600 p-2 text-white disabled:opacity-40" aria-label="Send">
            {streaming ? <Loader2 className="size-4 animate-spin" /> : <SendHorizonal className="size-4" />}
          </button>
        </div>
      </form>
    </aside>
  );
}
