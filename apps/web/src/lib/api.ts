import type {
  ActionKind,
  ApiErrorBody,
  AuditEvent,
  ChatEvent,
  CreateDealRequest,
  CreatedDeal,
  Deal,
  ExtensionRequestBody,
  HealthStatus,
  Party,
  PendingAction,
  SubmitProofRequest,
  UpdatePlanRequest,
} from "@arko/shared";
import { keyring } from "./keyring.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Every request carries the browser's deal keys; `dealId` selects the acting key for the current role. */
function authHeaders(dealId?: string): Record<string, string> {
  const h: Record<string, string> = { "X-Arko-Keys": keyring.all().join(",") };
  const key = dealId ? keyring.get(dealId, keyring.party()) : undefined;
  if (key) h["X-Arko-Key"] = key;
  return h;
}

async function request<T>(path: string, init: RequestInit = {}, dealId?: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(dealId), ...init.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error.code ?? "HTTP_ERROR", body?.error.message ?? res.statusText, body?.error.details);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown, dealId?: string) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }, dealId);
const ms = (dealId: string, milestoneId: string) => `/deals/${dealId}/milestones/${milestoneId}`;

export const api = {
  health: () =>
    request<HealthStatus & { mcpTools: Array<{ name: string; title?: string; annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean } }> }>("/health"),
  deals: () => request<Deal[]>("/deals"),
  deal: (id: string) => request<Deal>(`/deals/${id}`, {}, id),
  createDeal: (req: CreateDealRequest) => post<CreatedDeal>("/deals", req),
  accept: (dealId: string, version: number) => post<Deal>(`/deals/${dealId}/accept`, { version }, dealId),
  updatePlan: (dealId: string, plan: UpdatePlanRequest) =>
    request<Deal>(`/deals/${dealId}/plan`, { method: "PUT", body: JSON.stringify(plan) }, dealId),
  reviewPlan: (dealId: string) => post<Deal>(`/deals/${dealId}/plan/review`, {}, dealId),
  fund: (dealId: string, milestoneId: string) => post<{ deal: Deal; approveUrl: string }>(`${ms(dealId, milestoneId)}/fund`, {}, dealId),
  confirmFunding: (dealId: string, milestoneId: string) => post<Deal>(`${ms(dealId, milestoneId)}/confirm-funding`, {}, dealId),
  cancelFunding: (dealId: string, milestoneId: string) => post<Deal>(`${ms(dealId, milestoneId)}/cancel-funding`, {}, dealId),
  renewHold: (dealId: string, milestoneId: string) => post<Deal>(`${ms(dealId, milestoneId)}/renew-hold`, {}, dealId),
  submitProof: (dealId: string, milestoneId: string, proof: SubmitProofRequest) => post<Deal>(`${ms(dealId, milestoneId)}/proofs`, proof, dealId),
  verify: (dealId: string, milestoneId: string) => post<Deal>(`${ms(dealId, milestoneId)}/verify`, {}, dealId),
  requestExtension: (dealId: string, milestoneId: string, body: ExtensionRequestBody) =>
    post<Deal>(`${ms(dealId, milestoneId)}/extensions`, body, dealId),
  decideExtension: (dealId: string, milestoneId: string, extId: string, approve: boolean, note?: string) =>
    post<Deal>(`${ms(dealId, milestoneId)}/extensions/${extId}/decide`, { approve, note }, dealId),
  dispute: (dealId: string, milestoneId: string, statement: string) => post<Deal>(`${ms(dealId, milestoneId)}/dispute`, { statement }, dealId),
  mediate: (dealId: string, milestoneId: string) => post<Deal>(`${ms(dealId, milestoneId)}/mediate`, {}, dealId),
  acceptMediation: (dealId: string, milestoneId: string) => post<Deal>(`${ms(dealId, milestoneId)}/mediation/accept`, {}, dealId),
  propose: (dealId: string, milestoneId: string, kind: ActionKind, reason?: string) =>
    post<PendingAction>(`${ms(dealId, milestoneId)}/actions`, { kind, reason }, dealId),
  actions: () => request<PendingAction[]>("/actions"),
  approve: (a: PendingAction) => post<{ action: PendingAction; deal: Deal }>(`/actions/${a.id}/approve`, {}, a.dealId),
  reject: (a: PendingAction) => post<PendingAction>(`/actions/${a.id}/reject`, {}, a.dealId),
  activity: (dealId?: string) => request<AuditEvent[]>(dealId ? `/deals/${dealId}/activity` : "/activity", {}, dealId),
};

/** Stream Arko's reply as Server-Sent Events over a POST body. */
export async function streamChat(
  body: { message: string; dealId?: string; party: Party; history: Array<{ role: "user" | "assistant"; content: string }> },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(body.dealId) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    onEvent({ type: "error", message: err?.error.message ?? `Chat failed (${res.status})` });
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith("data:")) onEvent(JSON.parse(chunk.slice(5).trim()) as ChatEvent);
    }
  }
}

export const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
