# Technical guide

Rogue Agent Control is a local, single-owner application. API routes are not an authenticated public ingestion service. Keep the app bound to loopback unless authentication, tenancy, rate limits and deployment controls are designed and tested separately.

## Core records

SQLite stores runs, immutable owner mandates and policy versions, trusted merchant registry snapshots, original Black Box events, gateway decisions and sandbox lifecycle state. Accepted or failed investigation reports and policy replay results are separate artifacts. A report or simulation never rewrites an original event, proposal, policy or payment claim.

Every event has a versioned envelope with event, run and trace identifiers; optional parent reference; producer and collector timestamps; actor, type and tool; a typed allowlisted payload; and provenance. The collector owns receipt order and trusted provenance. Evidence shown in the inspector is the redacted persisted projection, not a raw external response or the model's private reasoning. Reported correlation is not proof of causality.

The schema and payload allowlists are in [`src/lib/contracts.ts`](../src/lib/contracts.ts). External producers cannot claim application or model provenance, append to synthetic runs, set policy authority or trigger a tool through an event payload. Unknown payload fields are stripped and counted before hashing and storage; invalid batches roll back completely. Never put credentials in an allowed identifier or mandate field. Redaction cannot recognize every arbitrary secret.

## Local API map

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Local storage health |
| GET / POST | `/api/runs` | List or create external recordings |
| GET | `/api/runs/:runId` | Read a run, ordered events and visibility notes |
| POST | `/api/runs/:runId/events` | Validate, redact and append an external event batch |
| POST | `/api/demos` | Record a labeled synthetic fixture |
| GET | `/api/integrations` | Safe model/catalog availability flags without key values |
| GET / POST | `/api/policies` | Read owner policy versions or create an immutable revision |
| POST | `/api/shopping` | Validate and save a pending shopping mandate/run |
| POST | `/api/shopping/:runId/execute` | Claim and execute a pending shopping run once |
| GET | `/api/shopping/:runId` | Read saved mandate, policy, products and recommendations |
| POST | `/api/gateway/authorize` | Evaluate a recorded proposal; no financial execution |
| POST | `/api/firewall/scenarios` | Create a labeled deterministic control scenario |
| GET / POST | `/api/investigation` | Read or generate a bounded evidence-linked investigation |
| POST | `/api/replay` | Pure what-if policy evaluation |
| GET | `/api/demo?scenario=quantity\|authorized\|violation\|practice` | Read one fixed guided scenario |

Sandbox checkout has a separate server-owned route and UI. It is not needed for the no-key demo or model/catalog setup; default automated tests use mock transport and do not perform transactions. Do not infer that a client-side status or replay decision authorizes that route.

For external recording, use JSON with a 256 KiB body limit and up to 100 events per batch. Typical responses include 400 for schema errors, 404 for an absent run, 409 for conflicting IDs or synthetic-run append attempts, 413 for an oversized request and 415 for non-JSON content. Requests with a foreign browser Origin are rejected. An external run is an unverified producer claim, not application-owned enforcement evidence.

PowerShell example with safe test values:

```powershell
$base = 'http://127.0.0.1:3000'
$recording = Invoke-RestMethod -Method Post -Uri "$base/api/runs" -ContentType 'application/json' -Body '{"persona":"consumer"}'
$recordingId = $recording.run.run_id
$eventId = 'evt_' + [guid]::NewGuid().ToString()
$batch = @{
  events = @(@{
    schema_version = 1
    event_id = $eventId
    timestamp = [DateTime]::UtcNow.ToString('o')
    actor = 'shopping_agent'
    event_type = 'purchase_proposed'
    tool = $null
    payload = @{
      product_id = 'shoe_api'
      merchant_id = 'approved_sports'
      unit_amount_minor = 12900
      total_amount_minor = 12900
      quantity = 1
      currency = 'USD'
    }
  })
} | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "$base/api/runs/$recordingId/events" -ContentType 'application/json' -Body $batch
Invoke-RestMethod -Uri "$base/api/runs/$recordingId"
```

This records a proposal claim only. It does not buy a product or turn the external run into a trusted shopping-agent execution.

## Firewall and replay

The trusted gateway loads the original application-owned mandate, frozen policy and catalog/merchant context. It then evaluates exact integer totals, currency, quantity, merchant and approval rules before any side-effecting adapter may run. DENY and REVIEW block execution; missing or invalid records fail closed. The agent cannot edit the owner policy or grant itself approval.

Replay uses the same pure evaluator with a frozen recorded proposal and alternative policy snapshot. It has no network-capable catalog, model or payment dependency. It stores a separate simulation artifact with original and hypothetical decisions, changed rule IDs and source references. An identical proposal/context/policy version must yield identical results.

## Investigation and demo

Deterministic findings are assembled from redacted Black Box events and stored decisions. Local Qwen3 receives a compact allowlisted evidence package. Its structured report must cite valid same-run event IDs and supported application facts; unsupported claims, fabricated citations and malformed JSON are rejected. A model failure leaves original evidence and deterministic findings available.

`GET /api/demo` accepts exactly one of four fixed scenario IDs. Genuine archives are opened read-only when present; if absent, the response says unavailable. Synthetic exercises use isolated memory and are labeled. The viewer cannot select arbitrary database paths, modify archived records or start a financial operation. See [demo architecture](DEMO_ARCHITECTURE.md) and [walkthrough](DEMO_WALKTHROUGH.md).

## Tests and extension boundary

Run `npm run typecheck`, `npm test`, `npm run test:e2e` and `npm run build`. Browser tests use Chromium and mocked external responses. Separate optional local-model/catalog smoke commands require local configuration and must be interpreted as real integration checks, never as mock proof. See [SETUP.md](SETUP.md) for obtaining and configuring those services.

Future authenticated multi-user deployment requires tenant isolation, approval ownership, safe retention and backup, rate limits, threat modeling and a review of all provider adapters. The current local trust boundary is deliberate.
