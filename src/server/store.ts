import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  defaultPolicy,
  parseEvent,
  parseRuntimeEvent,
  parseFirewallEvent,
  parsePaymentEvent,
  policySchema,
  type Persona,
  type PolicySnapshot,
  type Run,
  type RunDetail,
  type SafeEventInput,
  type Scenario,
  type StoredEvent,
  type RuntimeSource,
} from "../lib/contracts";
import type {
  Mandate,
  Product,
  Recommendation,
  ShoppingExecution,
} from "../lib/shopping-contracts";
import type {
  ActionRecord,
  FirewallDecision,
  OwnerPolicy,
} from "../lib/firewall-contracts";
import { visibilityGaps } from "../lib/evidence";

export class StoreError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export class BlackBoxStore {
  readonly db: Database.Database;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db
      .transaction(() => {
        this.db.exec(
          "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
        );
        const versions = this.db
          .prepare("SELECT version FROM schema_migrations")
          .all() as { version: number }[];
        if (versions.some((v) => v.version > 5))
          throw new Error("Database schema is newer than this application");
        if (!versions.some((v) => v.version === 1)) {
          this.db.exec(`
          CREATE TABLE runs (
            run_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
            persona TEXT NOT NULL CHECK(persona IN ('consumer','business')),
            mode TEXT NOT NULL CHECK(mode IN ('synthetic','external')),
            scenario TEXT, created_at TEXT NOT NULL, policy_json TEXT NOT NULL
          );
          CREATE TABLE events (
            event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id),
            sequence INTEGER NOT NULL, fingerprint TEXT NOT NULL, event_json TEXT NOT NULL,
            UNIQUE(run_id, sequence)
          );
          CREATE INDEX events_run_sequence ON events(run_id, sequence);
          CREATE INDEX runs_created ON runs(created_at);
        `);
          this.db
            .prepare("INSERT INTO schema_migrations VALUES (1, ?)")
            .run(new Date().toISOString());
        }
        if (!versions.some((v) => v.version === 2)) {
          this.db.exec(`
            ALTER TABLE runs ADD COLUMN execution_kind TEXT NOT NULL DEFAULT 'recording';
            CREATE TABLE shopping_mandates (mandate_id TEXT PRIMARY KEY, mandate_json TEXT NOT NULL);
            CREATE TABLE shopping_policies (policy_id TEXT PRIMARY KEY, mandate_id TEXT NOT NULL REFERENCES shopping_mandates(mandate_id), version TEXT NOT NULL UNIQUE, policy_json TEXT NOT NULL);
            CREATE TABLE shopping_executions (run_id TEXT PRIMARY KEY REFERENCES runs(run_id), mandate_id TEXT NOT NULL REFERENCES shopping_mandates(mandate_id), policy_id TEXT NOT NULL REFERENCES shopping_policies(policy_id), status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')), products_json TEXT NOT NULL DEFAULT '[]', recommendations_json TEXT NOT NULL DEFAULT '[]', error_code TEXT);
            CREATE TRIGGER immutable_mandate BEFORE UPDATE ON shopping_mandates BEGIN SELECT RAISE(ABORT, 'Mandates are immutable'); END;
            CREATE TRIGGER immutable_policy BEFORE UPDATE ON shopping_policies BEGIN SELECT RAISE(ABORT, 'Policies are immutable'); END;
            CREATE TRIGGER retain_mandate BEFORE DELETE ON shopping_mandates BEGIN SELECT RAISE(ABORT, 'Mandates are immutable'); END;
            CREATE TRIGGER retain_policy BEFORE DELETE ON shopping_policies BEGIN SELECT RAISE(ABORT, 'Policies are immutable'); END;
          `);
          this.db
            .prepare("INSERT INTO schema_migrations VALUES (2, ?)")
            .run(new Date().toISOString());
        }
        if (!versions.some((v) => v.version === 3)) {
          this.db.exec(`
            CREATE TABLE owner_policy_versions (version TEXT PRIMARY KEY, policy_id TEXT NOT NULL, revision INTEGER NOT NULL, owner_id TEXT NOT NULL, policy_json TEXT NOT NULL, UNIQUE(policy_id,revision));
            CREATE TABLE merchant_registries (version TEXT PRIMARY KEY, registry_json TEXT NOT NULL);
            CREATE TABLE firewall_proposals (proposal_id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(run_id),source_event_id TEXT NOT NULL REFERENCES events(event_id),recommendation_index INTEGER NOT NULL,record_json TEXT NOT NULL,UNIQUE(run_id,recommendation_index));
            CREATE TABLE firewall_decisions (decision_id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL UNIQUE REFERENCES firewall_proposals(proposal_id),record_json TEXT NOT NULL);
            CREATE TABLE gateway_claims (proposal_id TEXT PRIMARY KEY REFERENCES firewall_proposals(proposal_id),idempotency_key TEXT NOT NULL UNIQUE,run_id TEXT NOT NULL UNIQUE,mandate_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('mock_executing','mock_completed','mock_unknown')));
            CREATE INDEX firewall_run ON firewall_proposals(run_id);
          `);
          for (const table of [
            "owner_policy_versions",
            "merchant_registries",
            "firewall_proposals",
            "firewall_decisions",
          ]) {
            this.db.exec(
              `CREATE TRIGGER immutable_${table} BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Firewall records are immutable'); END; CREATE TRIGGER retain_${table} BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Firewall records are immutable'); END;`,
            );
          }
          this.db
            .prepare("INSERT INTO schema_migrations VALUES (3,?)")
            .run(new Date().toISOString());
        }
        if (!versions.some((v) => v.version === 4)) {
          this.db.exec(`
            CREATE TABLE sandbox_seller_mappings(version TEXT PRIMARY KEY,record_json TEXT NOT NULL);
            CREATE TABLE sandbox_payments(payment_id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL UNIQUE REFERENCES firewall_proposals(proposal_id),run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),mandate_id TEXT NOT NULL UNIQUE REFERENCES shopping_mandates(mandate_id),context_json TEXT NOT NULL,record_json TEXT NOT NULL);
            CREATE TRIGGER immutable_sandbox_mapping BEFORE UPDATE ON sandbox_seller_mappings BEGIN SELECT RAISE(ABORT,'Seller mappings are immutable'); END;
            CREATE TRIGGER retain_sandbox_mapping BEFORE DELETE ON sandbox_seller_mappings BEGIN SELECT RAISE(ABORT,'Seller mappings are immutable'); END;
            CREATE TRIGGER immutable_payment_context BEFORE UPDATE OF payment_id,proposal_id,run_id,mandate_id,context_json ON sandbox_payments BEGIN SELECT RAISE(ABORT,'Payment context is immutable'); END;
            CREATE TRIGGER retain_sandbox_payment BEFORE DELETE ON sandbox_payments BEGIN SELECT RAISE(ABORT,'Payment claims must be retained'); END;
          `);
          this.db
            .prepare("INSERT INTO schema_migrations VALUES(4,?)")
            .run(new Date().toISOString());
        }
        if (!versions.some((v) => v.version === 5)) {
          this.db.exec(
            `CREATE TABLE investigation_artifacts(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(run_id),kind TEXT NOT NULL CHECK(kind IN ('report','replay')),record_json TEXT NOT NULL); CREATE INDEX investigation_run ON investigation_artifacts(run_id); CREATE TRIGGER immutable_investigation BEFORE UPDATE ON investigation_artifacts BEGIN SELECT RAISE(ABORT,'Investigation artifacts are immutable'); END; CREATE TRIGGER retain_investigation BEFORE DELETE ON investigation_artifacts BEGIN SELECT RAISE(ABORT,'Investigation artifacts are immutable'); END;`,
          );
          this.db
            .prepare("INSERT INTO schema_migrations VALUES(5,?)")
            .run(new Date().toISOString());
        }
      })
      .immediate();
  }

  createRun(
    persona: Persona,
    options: {
      mode?: "synthetic" | "external";
      scenario?: Scenario;
      policy?: PolicySnapshot;
    } = {},
  ): Run {
    const mode = options.mode ?? "external";
    const run: Run = {
      run_id: `run_${randomUUID()}`,
      trace_id: `trace_${randomUUID()}`,
      title: `${persona === "consumer" ? "Running shoes" : "Office equipment"} / ${mode === "synthetic" ? (options.scenario === "authorized" ? "within mandate fixture" : "mandate deviation fixture") : "external recording"}`,
      persona,
      mode,
      scenario: options.scenario ?? null,
      created_at: new Date().toISOString(),
      policy: policySchema.parse(options.policy ?? defaultPolicy(persona)),
      event_count: 0,
    };
    this.db
      .prepare(
        "INSERT INTO runs (run_id,trace_id,title,persona,mode,scenario,created_at,policy_json) VALUES (@run_id,@trace_id,@title,@persona,@mode,@scenario,@created_at,@policy_json)",
      )
      .run({ ...run, policy_json: JSON.stringify(run.policy) });
    return run;
  }

  listRuns(): Run[] {
    const rows = this.db
      .prepare(
        "SELECT r.*, (SELECT COUNT(*) FROM events e WHERE e.run_id=r.run_id) event_count FROM runs r ORDER BY created_at DESC, run_id DESC",
      )
      .all();
    return rows.map((row) => this.decodeRun(row));
  }

  private decodeRun(row: unknown): Run {
    const r = row as Omit<Run, "policy"> & {
      policy_json: string;
      execution_kind: string;
    };
    return {
      run_id: r.run_id,
      trace_id: r.trace_id,
      title: r.title,
      persona: r.persona,
      mode:
        r.execution_kind === "shopping"
          ? "integration"
          : r.execution_kind === "firewall_fixture"
            ? "synthetic"
            : r.mode,
      scenario: r.scenario,
      created_at: r.created_at,
      policy: JSON.parse(r.policy_json),
      event_count: r.event_count,
      recording_kind: r.execution_kind as Run["recording_kind"],
    };
  }

  getRun(id: string): Run {
    const row = this.db
      .prepare(
        "SELECT r.*, (SELECT COUNT(*) FROM events e WHERE e.run_id=r.run_id) event_count FROM runs r WHERE run_id=?",
      )
      .get(id);
    if (!row) throw new StoreError(404, "Recording not found");
    return this.decodeRun(row);
  }

  detail(id: string): RunDetail {
    // Keep run counts and events in one read snapshot if a second local process writes.
    return this.db.transaction(() => {
      const run = this.getRun(id);
      const events = (
        this.db
          .prepare(
            "SELECT event_json FROM events WHERE run_id=? ORDER BY sequence ASC",
          )
          .all(id) as { event_json: string }[]
      ).map((row) => JSON.parse(row.event_json) as StoredEvent);
      return {
        run,
        events,
        gaps: visibilityGaps(run, events),
        ...(run.mode === "integration" ||
        run.recording_kind === "firewall_fixture"
          ? { shopping: this.getShopping(id) }
          : {}),
      };
    })();
  }

  append(
    id: string,
    inputs: unknown[],
    expectedMode: "synthetic" | "external" = "external",
  ) {
    const safe = inputs.map(parseEvent); // Validate/redact the entire batch before any write.
    return this.db
      .transaction(() => this.insertSafe(id, safe, expectedMode))
      .immediate();
  }

  private insertSafe(
    id: string,
    inputs: SafeEventInput[],
    expectedMode: "synthetic" | "external" | "integration",
    source?: RuntimeSource,
  ) {
    const run = this.getRun(id);
    if (run.mode !== expectedMode)
      throw new StoreError(
        409,
        "External ingestion cannot modify a synthetic recording or application-owned shopping execution",
      );
    let sequence = (
      this.db
        .prepare(
          "SELECT COALESCE(MAX(sequence),0) n FROM events WHERE run_id=?",
        )
        .get(id) as { n: number }
    ).n;
    let inserted = 0;
    let duplicates = 0;
    for (const input of inputs) {
      const fingerprint = createHash("sha256")
        .update(
          canonical(
            expectedMode === "integration" || input.schema_version >= 3
              ? { event: input, source: source ?? "application" }
              : input,
          ),
        )
        .digest("hex");
      const prior = this.db
        .prepare("SELECT run_id,fingerprint FROM events WHERE event_id=?")
        .get(input.event_id) as
        | { run_id: string; fingerprint: string }
        | undefined;
      if (prior) {
        if (prior.run_id !== id || prior.fingerprint !== fingerprint)
          throw new StoreError(
            409,
            "Event ID already exists with different evidence",
          );
        duplicates++;
        continue;
      }
      const event: StoredEvent = {
        ...input,
        run_id: id,
        trace_id: run.trace_id,
        policy_version: run.policy.version,
        sequence: ++sequence,
        recorded_at: new Date().toISOString(),
        provenance: {
          source:
            expectedMode === "integration" || source !== undefined
              ? (source ?? "application")
              : expectedMode === "synthetic"
                ? "synthetic_fixture"
                : "external_ingestion",
          mode: expectedMode,
          trusted:
            (expectedMode === "integration" || input.schema_version === 3) &&
            ["application", "policy_firewall", "trusted_gateway"].includes(
              source ?? "",
            ),
        },
      };
      this.db
        .prepare("INSERT INTO events VALUES (?,?,?,?,?)")
        .run(
          event.event_id,
          id,
          event.sequence,
          fingerprint,
          JSON.stringify(event),
        );
      inserted++;
    }
    return { inserted, duplicates };
  }

  createShopping(
    mandate: Mandate,
    policy: PolicySnapshot,
    fixture = false,
  ): Run {
    return this.db
      .transaction(() => {
        const run = this.createRun(mandate.persona, { policy });
        this.db
          .prepare("INSERT INTO shopping_mandates VALUES (?,?)")
          .run(mandate.mandate_id, JSON.stringify(mandate));
        this.db
          .prepare("INSERT INTO shopping_policies VALUES (?,?,?,?)")
          .run(
            policy.version,
            mandate.mandate_id,
            policy.version,
            JSON.stringify(policy),
          );
        this.db
          .prepare(
            "INSERT INTO shopping_executions (run_id,mandate_id,policy_id,status) VALUES (?,?,?,'pending')",
          )
          .run(run.run_id, mandate.mandate_id, policy.version);
        this.db
          .prepare("UPDATE runs SET execution_kind=?,title=? WHERE run_id=?")
          .run(
            fixture ? "firewall_fixture" : "shopping",
            fixture
              ? "Policy Firewall / controlled synthetic fixture"
              : `${mandate.persona === "consumer" ? "Consumer shopping" : "Business purchasing"} / ${mandate.catalog_mode === "offline" ? "seeded catalog" : "Channel3 live"}`,
            run.run_id,
          );
        return this.getRun(run.run_id);
      })
      .immediate();
  }

  getShopping(id: string): ShoppingExecution {
    const row = this.db
      .prepare(
        "SELECT e.*,m.mandate_json,p.policy_json FROM shopping_executions e JOIN shopping_mandates m USING(mandate_id) JOIN shopping_policies p USING(policy_id) WHERE run_id=?",
      )
      .get(id) as
      | {
          status: ShoppingExecution["status"];
          mandate_json: string;
          policy_json: string;
          products_json: string;
          recommendations_json: string;
          error_code: string | null;
        }
      | undefined;
    if (!row) throw new StoreError(404, "Shopping execution not found");
    const policy: PolicySnapshot = JSON.parse(row.policy_json);
    const fixture = this.getRun(id).recording_kind === "firewall_fixture";
    const proposals = policy.firewall
      ? (
          this.db
            .prepare(
              "SELECT record_json FROM firewall_proposals WHERE run_id=? ORDER BY recommendation_index",
            )
            .all(id) as { record_json: string }[]
        ).map((r) => JSON.parse(r.record_json) as ActionRecord)
      : [];
    const decisions = policy.firewall
      ? (
          this.db
            .prepare(
              "SELECT d.record_json FROM firewall_decisions d JOIN firewall_proposals p USING(proposal_id) WHERE p.run_id=? ORDER BY p.recommendation_index",
            )
            .all(id) as { record_json: string }[]
        ).map((r) => JSON.parse(r.record_json) as FirewallDecision)
      : [];
    const ownerPolicy = policy.firewall
      ? (this.db
          .prepare(
            "SELECT policy_json FROM owner_policy_versions WHERE version=?",
          )
          .get(policy.firewall.owner_policy_version) as
          | { policy_json: string }
          | undefined)
      : undefined;
    return {
      run_id: id,
      mandate: JSON.parse(row.mandate_json),
      policy,
      status: row.status,
      products: JSON.parse(row.products_json),
      recommendations: JSON.parse(row.recommendations_json),
      error_code: row.error_code,
      ...(policy.firewall
        ? {
            firewall: {
              owner_policy: ownerPolicy
                ? (JSON.parse(ownerPolicy.policy_json) as OwnerPolicy)
                : null,
              proposals,
              decisions,
              payment_adapter_installed: false as const,
            },
          }
        : {}),
      ...(fixture ? { evidence_mode: "synthetic_fixture" as const } : {}),
    };
  }

  claimShopping(id: string) {
    this.getShopping(id);
    const result = this.db
      .prepare(
        "UPDATE shopping_executions SET status='running' WHERE run_id=? AND status='pending'",
      )
      .run(id);
    if (result.changes !== 1)
      throw new StoreError(
        409,
        "This execution has already started. Create a new shopping run to try again.",
      );
  }

  saveShoppingProducts(id: string, products: Product[]) {
    this.db
      .prepare(
        "UPDATE shopping_executions SET products_json=? WHERE run_id=? AND status='running'",
      )
      .run(JSON.stringify(products), id);
  }

  finishShopping(
    id: string,
    recommendations: Recommendation[],
    errorCode: string | null,
  ) {
    this.db
      .prepare(
        "UPDATE shopping_executions SET status=?,recommendations_json=?,error_code=? WHERE run_id=? AND status='running'",
      )
      .run(
        errorCode ? "failed" : "completed",
        JSON.stringify(recommendations),
        errorCode,
        id,
      );
  }

  appendRuntime(id: string, inputs: unknown[], source: RuntimeSource) {
    const safe = inputs.map(parseRuntimeEvent);
    return this.db
      .transaction(() =>
        this.insertSafe(
          id,
          safe,
          this.getRun(id).recording_kind === "firewall_fixture"
            ? "synthetic"
            : "integration",
          source,
        ),
      )
      .immediate();
  }

  appendFirewall(
    id: string,
    inputs: unknown[],
    source: "policy_firewall" | "trusted_gateway",
  ) {
    const safe = inputs.map(parseFirewallEvent);
    return this.db
      .transaction(() => {
        const run = this.getRun(id);
        if (!run.policy.firewall)
          throw new StoreError(
            409,
            "Historical research recordings cannot be relabeled as protected",
          );
        return this.insertSafe(
          id,
          safe,
          run.recording_kind === "firewall_fixture"
            ? "synthetic"
            : "integration",
          source,
        );
      })
      .immediate();
  }

  lastEventId(id: string): string | null {
    const row = this.db
      .prepare(
        "SELECT event_id FROM events WHERE run_id=? ORDER BY sequence DESC LIMIT 1",
      )
      .get(id) as { event_id: string } | undefined;
    return row?.event_id ?? null;
  }

  appendPayment(
    id: string,
    inputs: unknown[],
    source: "trusted_gateway" | "paypal_sandbox",
  ) {
    const safe = inputs.map(parsePaymentEvent);
    return this.db
      .transaction(() => {
        const run = this.getRun(id);
        if (
          run.mode !== "integration" ||
          run.recording_kind !== "shopping" ||
          !run.policy.firewall
        )
          throw new StoreError(
            409,
            "Payment evidence requires a protected actual shopping run",
          );
        return this.insertSafe(id, safe, "integration", source);
      })
      .immediate();
  }

  createSynthetic(
    persona: Persona,
    scenario: Scenario,
    makeEvents: (run: Run) => unknown[],
  ): Run {
    return this.db
      .transaction(() => {
        const run = this.createRun(persona, { mode: "synthetic", scenario });
        const inputs = makeEvents(run).map(parseEvent);
        this.insertSafe(run.run_id, inputs, "synthetic");
        return this.getRun(run.run_id);
      })
      .immediate();
  }

  close() {
    this.db.close();
  }
}

const globalStore = globalThis as typeof globalThis & {
  rogueStore?: BlackBoxStore;
};
export function getStore() {
  globalStore.rogueStore ??= new BlackBoxStore(
    process.env.DATABASE_PATH ||
      resolve(process.cwd(), "data/rogue-control.sqlite"),
  );
  return globalStore.rogueStore;
}
