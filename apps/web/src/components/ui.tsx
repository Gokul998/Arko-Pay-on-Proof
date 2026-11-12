import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { MilestoneStatus } from "@arko/shared";
import { STATUS_META } from "../lib/format.ts";

export const Spinner = ({ className = "size-4" }: { className?: string }) => (
  <Loader2 className={`${className} animate-spin`} aria-hidden />
);

export function StatusBadge({ status }: { status: MilestoneStatus }) {
  const meta = STATUS_META[status];
  return <span className={`chip ${meta.tone}`}>{meta.label}</span>;
}

// Literal class names so Tailwind's scanner can see every variant.
const VARIANT = {
  primary: "btn-primary",
  paypal: "btn-paypal",
  success: "btn-success",
  ghost: "btn-ghost",
  danger: "btn-danger",
} as const;

export function Button({
  busy,
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: "primary" | "paypal" | "success" | "ghost" | "danger" }) {
  return (
    <button {...props} className={`${VARIANT[variant]} ${props.className ?? ""}`} disabled={busy || props.disabled}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Section({ title, icon, children, aside }: { title: string; icon?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          {icon}
          {title}
        </h4>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="rounded-2xl bg-brand-50 p-3 text-brand-600 dark:bg-brand-600/10">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="max-w-md text-sm text-slate-500 dark:text-slate-400">{children}</div>}
    </div>
  );
}
