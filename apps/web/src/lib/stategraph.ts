import { fromCents, milestoneHealth, toCents, type Deal, type Milestone } from "@arko/shared";
import { formatMoney } from "./format.ts";
import type { Layer, NodeState } from "./orchestration.ts";

/**
 * Builds a Step Functions–style state machine for a deal: Task / Choice / Parallel / Map /
 * Wait-for-human states, laid out top-to-bottom, with live execution state on every node.
 */
export type StepKind = "start" | "end" | "task" | "wait" | "choice" | "fork" | "join" | "map" | "header" | "success";

export interface StepNode {
  id: string;
  kind: StepKind;
  label: string;
  detail: string;
  layer: Layer | "system";
  state: NodeState;
  x: number; // center
  y: number; // top
  width: number;
  milestoneId?: string;
  stepType: string; // e.g. "Task · AI agent", "Wait · human approval (task token)"
}

export interface StepEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  state: "traversed" | "active" | "pending" | "skipped";
}

const ROW = 118;
const COL = 380;
const W = { task: 230, branch: 168, header: 260, bar: 360, choice: 76, terminal: 64 };

export function buildStateMachine(deal: Deal): { nodes: StepNode[]; edges: StepEdge[] } {
  const nodes: StepNode[] = [];
  const edges: StepEdge[] = [];
  const add = (n: StepNode) => (nodes.push(n), n);
  const link = (a: StepNode, b: StepNode, label?: string) =>
    edges.push({ id: `${a.id}->${b.id}`, source: a.id, target: b.id, label, state: edgeState(a.state, b.state) });

  const agreed = deal.status !== "proposed";
  const total = fromCents(deal.milestones.reduce((t, m) => t + toCents(m.amount), 0));
  const review = deal.planReview;
  let y = 0;
  const row = () => (y += ROW);

  const start = add({ id: "start", kind: "start", label: "Start", detail: "Deal created", layer: "system", state: "done", x: 0, y, width: W.terminal, stepType: "Start" });
  const ingest = add({
    id: "ingest", kind: "task", label: "Read SOW", layer: "ai", state: "done", x: 0, y: row() - 30, width: W.task, stepType: "Task · Contract Agent (document AI)",
    detail: deal.sourceDocument ? deal.sourceDocument.name : "Pasted agreement",
  });
  const split = add({
    id: "split", kind: "task", label: "AI milestone split", layer: "ai", state: "done", x: 0, y: row(), width: W.task, stepType: "Task · Contract Agent",
    detail: `${deal.milestones.length} milestones · ${formatMoney(total, deal.currency)} · v1`,
  });
  const reviewN = add({
    id: "review", kind: "task", label: "Plan review", layer: "ai", x: 0, y: row(), width: W.task, stepType: "Task · Plan Reviewer (optional)",
    state: review ? (review.issues.some((i) => i.severity === "blocker") && !agreed ? "alert" : "done") : agreed ? "skipped" : "waiting",
    detail: review ? `Readiness ${review.readiness}/100 on v${review.version}` : "Optional AI quality gate",
  });
  const negotiate = add({
    id: "negotiate", kind: "task", label: "Negotiate plan", layer: "human", x: 0, y: row(), width: W.task, stepType: "Loop · versioned revisions",
    state: agreed ? "done" : "active", detail: `${deal.revisions.length} version${deal.revisions.length > 1 ? "s" : ""} · now v${deal.version}`,
  });
  const fork = add({ id: "fork", kind: "fork", label: "Parallel approvals", detail: "Both must approve the same version", layer: "system", state: agreed ? "done" : "active", x: 0, y: row() - 20, width: W.bar, stepType: "Parallel" });
  const apY = row() - 30;
  const ap = (p: "client" | "freelancer", x: number) =>
    add({
      id: `approve-${p}`, kind: "wait", label: `${p === "client" ? "Client" : "Freelancer"} approves`, layer: "human", x, y: apY, width: W.branch + 30,
      stepType: "Wait · human approval (task token)",
      state: agreed || deal.acceptedBy.includes(p) ? "done" : "active",
      detail: agreed || deal.acceptedBy.includes(p) ? `Approved v${deal.version}` : `Approve v${deal.version}`,
    });
  const apC = ap("client", -150);
  const apF = ap("freelancer", 150);
  const join = add({ id: "join", kind: "join", label: "Plan locked", detail: agreed ? `v${deal.version} signed by both` : "Waiting for both", layer: "system", state: agreed ? "done" : "waiting", x: 0, y: row() - 10, width: W.bar, stepType: "Parallel · join" });
  const map = add({
    id: "map", kind: "map", label: `Run ${deal.milestones.length} milestones`, layer: "system", x: 0, y: row() - 10, width: W.header,
    stepType: "Map · one branch per milestone, each on its own PayPal hold",
    state: deal.status === "completed" ? "done" : agreed ? "active" : "waiting",
    detail: `${formatMoney(total, deal.currency)} across ${deal.milestones.length} holds`,
  });
  link(start, ingest); link(ingest, split); link(split, reviewN); link(reviewN, negotiate); link(negotiate, fork);
  link(fork, apC); link(fork, apF); link(apC, join); link(apF, join); link(join, map);

  // Map branches
  const n = deal.milestones.length;
  const baseY = y + ROW - 10;
  let maxY = baseY;
  const settledNodes: StepNode[] = [];
  deal.milestones.forEach((m, i) => {
    const cx = (i - (n - 1) / 2) * COL;
    const b = branch(deal, m, cx, baseY, agreed);
    nodes.push(...b.nodes);
    edges.push(...b.edges);
    link(map, b.nodes[0]!);
    settledNodes.push(b.nodes[b.nodes.length - 1]!);
    maxY = Math.max(maxY, ...b.nodes.map((x) => x.y));
  });

  const done = deal.status === "completed";
  const mapJoin = add({ id: "map-join", kind: "join", label: "All milestones settled", detail: `${deal.milestones.filter((m) => ["released", "settled", "cancelled"].includes(m.status)).length}/${n} closed`, layer: "system", state: done ? "done" : "waiting", x: 0, y: maxY + ROW, width: Math.max(W.bar, n * COL - 80), stepType: "Map · join" });
  const end = add({ id: "end", kind: "end", label: "End", detail: done ? "Deal complete" : "Running", layer: "system", state: done ? "done" : "waiting", x: 0, y: maxY + ROW * 2 - 20, width: W.terminal, stepType: "End" });
  settledNodes.forEach((s) => link(s, mapJoin));
  link(mapJoin, end);
  return { nodes, edges };
}

function branch(deal: Deal, m: Milestone, cx: number, y0: number, agreed: boolean) {
  const nodes: StepNode[] = [];
  const edges: StepEdge[] = [];
  const s = m.status;
  const h = milestoneHealth(m, deal.terms);
  const mid = m.id;
  const id = (k: string) => `${mid}:${k}`;
  const money = formatMoney(m.amount, deal.currency);
  const cancelled = s === "cancelled";
  const held = ["funded", "submitted", "verified", "disputed", "mediated", "released", "settled"].includes(s) || (cancelled && !!m.paypal.authorizationId);
  const disputed = ["disputed", "mediated"].includes(s) || (s === "settled" && !!m.mediation);
  const passed = s === "released" || (["verified"].includes(s) && m.verification?.recommendation === "release");
  const closed = ["released", "settled", "cancelled"].includes(s);
  let y = y0;
  const add = (n: Omit<StepNode, "milestoneId">) => {
    const node = { ...n, milestoneId: mid };
    nodes.push(node);
    return node;
  };
  const link = (a: StepNode, b: StepNode, label?: string) => edges.push({ id: `${a.id}->${b.id}`, source: a.id, target: b.id, label, state: edgeState(a.state, b.state) });

  const header = add({
    id: id("head"), kind: "header", label: `M${m.position} · ${m.title}`, layer: "system", x: cx, y, width: W.header, stepType: "Map iteration",
    state: closed ? "done" : agreed ? "active" : "waiting",
    detail: `${money}${m.dueDate ? ` · due ${m.dueDate}` : ""}${m.dependsOn ? ` · after M${deal.milestones.find((x) => x.id === m.dependsOn)?.position}` : ""}`,
  });
  const hold = add({
    id: id("hold"), kind: "task", label: "PayPal hold", layer: "paypal", x: cx, y: (y += ROW), width: W.task, stepType: "Task · Orders v2 AUTHORIZE (MCP)",
    state: held ? (h.holdNeedsRenewal ? "alert" : "done") : cancelled ? "skipped" : !agreed ? "waiting" : "active",
    detail: m.paypal.authorizationId ? (h.holdNeedsRenewal ? "Renew — expires before due date" : `${money} held${m.paypal.holdExpiresAt && !closed ? ` · until ${m.paypal.holdExpiresAt}` : ""}`) : s === "funding_pending" ? "Client approving in PayPal" : `Hold ${money}`,
  });
  const deliver = add({
    id: id("deliver"), kind: "wait", label: "Deliver proof", layer: "human", x: cx, y: (y += ROW), width: W.task, stepType: "Wait · freelancer callback (task token)",
    state: m.proofs.length ? "done" : cancelled ? "skipped" : h.overdue ? "alert" : s === "funded" ? "active" : "waiting",
    detail: m.proofs.length ? `${m.proofs.length} proof item${m.proofs.length > 1 ? "s" : ""}` : h.pendingExtension ? `Extension asked → ${h.pendingExtension.toDate}` : h.overdue ? `${h.daysLate}d late` : m.dueDate ? `Due ${m.dueDate}` : "Awaiting delivery",
  });
  const verify = add({
    id: id("verify"), kind: "task", label: "Verifier Agent", layer: "ai", x: cx, y: (y += ROW), width: W.task, stepType: "Task · AI vision check vs definition of done",
    state: m.verification ? "done" : cancelled ? "skipped" : s === "submitted" ? "active" : disputed && !m.verification ? "skipped" : "waiting",
    detail: m.verification ? `${m.verification.verdict} · ${m.verification.score}/100` : `${m.criteria.length} criteria to check`,
  });
  const choice = add({
    id: id("choice"), kind: "choice", label: "Passed?", layer: "system", x: cx, y: (y += ROW - 6), width: W.choice, stepType: "Choice · verdict = pass AND no dispute",
    state: passed || disputed ? "done" : cancelled ? "skipped" : s === "verified" ? "active" : "waiting",
    detail: passed ? "pass → release" : disputed ? "dispute → mediation" : m.verification ? `recommends ${m.verification.recommendation.replace("_", " ")}` : "Pending verdict",
  });
  y += ROW + 4;
  const L = cx - 96;
  const R = cx + 96;
  const approve = add({
    id: id("approve"), kind: "wait", label: "Client approves", layer: "human", x: L, y, width: W.branch, stepType: "Wait · human-in-the-loop approval gate",
    state: s === "released" ? "done" : disputed || cancelled ? "skipped" : passed ? "active" : "waiting",
    detail: h.reviewDueAt && !closed ? `Review by ${h.reviewDueAt}` : "Policy checks + approve",
  });
  const mediate = add({
    id: id("mediate"), kind: "task", label: "Mediator Agent", layer: "ai", x: R, y, width: W.branch, stepType: "Task · AI mediation of both statements",
    state: m.mediation ? "done" : disputed ? "active" : s === "released" || cancelled ? "skipped" : "waiting",
    detail: m.mediation ? `${m.mediation.freelancerPercent}% to freelancer` : "Fair split proposal",
  });
  y += ROW;
  const capture = add({
    id: id("capture"), kind: "task", label: "Capture", layer: "paypal", x: L, y, width: W.branch, stepType: "Task · Payments v2 capture + receipt invoice",
    state: s === "released" ? "done" : disputed || cancelled ? "skipped" : "waiting",
    detail: s === "released" ? `${formatMoney(m.capturedAmount ?? m.amount, deal.currency)} paid` : "Full release",
  });
  const accept = add({
    id: id("accept"), kind: "wait", label: "Both accept split", layer: "human", x: R, y, width: W.branch, stepType: "Parallel wait · client + freelancer",
    state: s === "settled" || m.mediation?.acceptedBy.length === 2 ? "done" : s === "mediated" ? "active" : s === "released" || cancelled ? "skipped" : "waiting",
    detail: `Accepted: ${m.mediation?.acceptedBy.join(" & ") || "—"}`,
  });
  y += ROW;
  const partial = add({
    id: id("partial"), kind: "task", label: "Partial capture", layer: "paypal", x: R, y, width: W.branch, stepType: "Task · capture share, final_capture voids the rest",
    state: s === "settled" ? "done" : s === "released" || cancelled ? "skipped" : m.mediation?.acceptedBy.length === 2 ? "active" : "waiting",
    detail: s === "settled" ? `${formatMoney(m.capturedAmount ?? "0", deal.currency)} paid` : "Split payout",
  });
  y += ROW;
  const settled = add({
    id: id("settled"), kind: "success", label: cancelled ? "Cancelled · returned" : s === "settled" ? "Settled by split" : "Paid", layer: "system", x: cx, y, width: W.task - 40, stepType: "Succeed",
    state: closed ? "done" : "waiting",
    detail: cancelled ? "Hold voided" : closed ? "Funds moved" : "Not settled yet",
  });

  link(header, hold); link(hold, deliver); link(deliver, verify); link(verify, choice);
  link(choice, approve, "pass"); link(choice, mediate, "dispute");
  link(approve, capture); link(mediate, accept); link(accept, partial);
  link(capture, settled); link(partial, settled);
  return { nodes, edges };
}

function edgeState(a: NodeState, b: NodeState): StepEdge["state"] {
  if (a === "skipped" || b === "skipped") return "skipped";
  if (a === "done" && b === "done") return "traversed";
  if (a === "done" && (b === "active" || b === "alert")) return "active";
  return "pending";
}
