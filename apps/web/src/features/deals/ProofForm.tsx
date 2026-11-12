import { useRef, useState } from "react";
import { FileUp, Link2, StickyNote, Upload } from "lucide-react";
import type { Deal, Milestone } from "@arko/shared";
import { api, fileToBase64 } from "../../lib/api.ts";
import { useStore } from "../../lib/store.tsx";
import { Button } from "../../components/ui.tsx";

type Kind = "file" | "link" | "note";

export function ProofForm({ deal, milestone }: { deal: Deal; milestone: Milestone }) {
  const { run, busy, upsertDeal } = useStore();
  const [kind, setKind] = useState<Kind>("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const key = `proof-${milestone.id}`;

  const submit = async () => {
    const payload =
      kind === "file" && file
        ? { kind, name: file.name, mimeType: file.type || "application/octet-stream", dataBase64: await fileToBase64(file), note: note || undefined }
        : kind === "link"
          ? { kind, name: url, url, note: note || undefined }
          : { kind, name: note.slice(0, 60) || "Note", note };
    const updated = await run(key, () => api.submitProof(deal.id, milestone.id, payload), "Proof submitted");
    if (updated) {
      upsertDeal(updated);
      setFile(null);
      setUrl("");
      setNote("");
    }
  };

  const valid = kind === "file" ? !!file : kind === "link" ? /^https?:\/\//.test(url) : note.trim().length > 5;

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs font-medium dark:bg-slate-800">
        {([
          ["file", <FileUp key="f" className="size-3.5" />, "File / image"],
          ["link", <Link2 key="l" className="size-3.5" />, "Link"],
          ["note", <StickyNote key="n" className="size-3.5" />, "Note"],
        ] as const).map(([k, icon, label]) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 ${kind === k ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500"}`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {kind === "file" && (
        <button
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-1 rounded-xl bg-slate-50 py-6 text-sm text-slate-500 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800"
        >
          <Upload className="size-5" />
          {file ? <span className="font-medium text-slate-800 dark:text-slate-200">{file.name}</span> : "Choose an image, PDF or text file (max 10 MB)"}
          <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/*,.md,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </button>
      )}
      {kind === "link" && <input className="input" placeholder="https://… (live site, Figma, Drive)" value={url} onChange={(e) => setUrl(e.target.value)} />}
      <textarea
        className="input min-h-16"
        placeholder={kind === "note" ? "Describe what you delivered…" : "Optional note for the client and the Verifier"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex justify-end">
        <Button busy={busy[key]} disabled={!valid} onClick={submit}>
          Submit proof
        </Button>
      </div>
    </div>
  );
}
