import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AuditEvent, Deal, PendingAction } from "@arko/shared";
import type { ActionRepository, AuditLog, DealRepository } from "../../application/ports.ts";
import { newId } from "../../application/ids.ts";

/**
 * SQLite via Node's built-in driver (no native build step). Aggregates are stored as
 * JSON documents with indexed columns for the fields we filter on.
 */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY, doc TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY, deal_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS actions_deal ON actions(deal_id, status);
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY, deal_id TEXT, doc TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_deal ON audit(deal_id, created_at);
  `);
  return db;
}

type DocRow = { doc: string };
const parse = <T>(row: unknown): T => JSON.parse((row as DocRow).doc) as T;

export class SqliteDealRepository implements DealRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Deal[] {
    return this.db.prepare("SELECT doc FROM deals ORDER BY created_at DESC").all().map((r) => parse<Deal>(r));
  }

  get(id: string): Deal | undefined {
    const row = this.db.prepare("SELECT doc FROM deals WHERE id = ?").get(id);
    return row ? parse<Deal>(row) : undefined;
  }

  save(deal: Deal): void {
    this.db
      .prepare(
        `INSERT INTO deals (id, doc, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`,
      )
      .run(deal.id, JSON.stringify(deal), deal.createdAt, new Date().toISOString());
  }
}

export class SqliteActionRepository implements ActionRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(filter: { dealId?: string; status?: PendingAction["status"] } = {}): PendingAction[] {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.dealId) {
      where.push("deal_id = ?");
      args.push(filter.dealId);
    }
    if (filter.status) {
      where.push("status = ?");
      args.push(filter.status);
    }
    const sql = `SELECT doc FROM actions ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`;
    return this.db.prepare(sql).all(...args).map((r) => parse<PendingAction>(r));
  }

  get(id: string): PendingAction | undefined {
    const row = this.db.prepare("SELECT doc FROM actions WHERE id = ?").get(id);
    return row ? parse<PendingAction>(row) : undefined;
  }

  save(a: PendingAction): void {
    this.db
      .prepare(
        `INSERT INTO actions (id, deal_id, status, doc, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, doc = excluded.doc`,
      )
      .run(a.id, a.dealId, a.status, JSON.stringify(a), a.createdAt);
  }
}

export class SqliteAuditLog implements AuditLog {
  constructor(private readonly db: DatabaseSync) {}

  record(event: Omit<AuditEvent, "id" | "createdAt">): AuditEvent {
    const full: AuditEvent = { ...event, id: newId("evt"), createdAt: new Date().toISOString() };
    this.db
      .prepare("INSERT INTO audit (id, deal_id, doc, created_at) VALUES (?, ?, ?, ?)")
      .run(full.id, full.dealId, JSON.stringify(full), full.createdAt);
    return full;
  }

  list(dealId?: string, limit = 200): AuditEvent[] {
    const rows = dealId
      ? this.db.prepare("SELECT doc FROM audit WHERE deal_id = ? ORDER BY created_at DESC LIMIT ?").all(dealId, limit)
      : this.db.prepare("SELECT doc FROM audit ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map((r) => parse<AuditEvent>(r));
  }
}
