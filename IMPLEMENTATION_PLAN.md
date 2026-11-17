# Rogue Agent Control implementation plan

Source of truth: [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md). Scope: consumer and B2B shopping agents. Black Box, the shopping agent, deterministic Policy Firewall, sandbox boundary, investigation, replay and local demo are implemented. This plan records the current public architecture and verification state. Private historical recordings and provider-specific test details are deliberately excluded from the public source package.

## Current decisions

1. **Black Box is primary.** The UI leads with original events and provenance. Reports and replay artifacts are stored separately from the immutable original event sequence.
2. **Ownership stays outside the model.** The application owns mandates, policy versions, merchant mappings and approval authority. The model may only propose a product and quantity.
3. **Financial arithmetic is exact.** Budget and price calculations use integer minor currency units, validated quantity and explicit currency agreement.
4. **The gateway fails closed.** DENY, REVIEW, missing policy, unknown merchant, invalid input and evaluation failure cannot invoke a payment adapter. The sandbox adapter is server-only and has no live mode.
5. **Source labels are honest.** Seeded catalog, actual Qwen3, optional live Channel3, synthetic fixtures, unverified external claims and observed sandbox responses remain distinguishable.
6. **Replay is isolated.** It evaluates a frozen recorded proposal with no payment, catalog or model dependency. A hypothetical ALLOW is never executable authorization.
7. **Local-first distribution.** The no-key demo runs on a clean checkout. Private genuine SQLite archives, credentials, logs and buyer information are not distributed.

## Phase 1: Black Box foundation — complete

**Deliverables:** Next.js application, typed event envelope, SQLite persistence, redaction before storage, synthetic fixture labeling, correlated timeline, evidence inspector and AG Grid Community explorer.

**Acceptance:** Record consumer and B2B synthetic runs; inspect event IDs, timestamps, parent/trace/run references, provenance and stored JSON; filter and select events; restart and retain evidence. Malformed or conflicting event batches cannot partially persist. Visibility gaps are explicit.

**Dependencies and tests:** Node.js, SQLite driver and browser. Unit/API tests cover validation, idempotency, redaction, immutable evidence and persistence. Browser tests cover timeline, explorer and narrow layout. No external account is required.

## Phase 2: Shopping agent and catalog — complete

**Deliverables:** local Ollama/Qwen3 4B shopping research, seeded catalog, optional read-only Channel3 search, immutable owner mandates and initial policy records, model/tool event instrumentation.

**Acceptance:** Actual model decisions are stored as actual model evidence, including deviations. Catalog errors are visible; live failures never silently fall back to seeded products. Product descriptions are untrusted data. Existing synthetic Black Box recordings remain unchanged.

**Dependencies and tests:** Ollama and `qwen3:4b` for actual local-model use; `CHANNEL3_API_KEY` only for optional live discovery. Unit tests mock transport and validate exact request/response contracts; separate local smoke checks verified real model and catalog connections in the owner's environment. A fresh checkout can use seeded fixtures without either service.

## Phase 3: Policy Firewall and trusted gateway — complete

**Deliverables:** versioned owner policies, deterministic ALLOW/DENY/REVIEW evaluator, trusted source-specific merchant registry, quantity mismatch controls, gateway authorization records and Black Box rule evidence.

**Acceptance:** $149 is allowed and $151 denied under a $150 cap when other rules pass; currency and merchant failures deny; quantity mismatch produces its configured DENY or REVIEW; review never executes. Agent/client claims to alter budget, merchant, policy version or approval are rejected. Mock adapters receive zero calls for denied, pending or malformed actions.

**Dependencies and tests:** Phase 2 frozen mandates and proposals. Unit/API tests cover integer boundaries, overflow, ownership, policy immutability, bypass and duplicate/concurrent calls. The only disabled-control fixture exists in isolated tests with an in-memory adapter.

## Phase 4: Sandbox payment boundary — complete

**Deliverables:** optional server-side test payment adapter; seller mapping, context revalidation, order creation, buyer approval verification, capture, cancellation and read-only reconciliation as distinct persisted stages. Separate idempotency IDs and conservative retry rules prevent duplicate side effects.

**Acceptance:** Only a validated actual-agent seeded proposal with ALLOW can reach the adapter. Redirect flags do not prove approval; capture requires verified approval and a separate owner action. Unknown states remain unresolved instead of inferred as success. No live payment mode or retailer fulfillment is claimed.

**Dependencies and tests:** Phase 3 gateway. Default unit/API/browser tests use mocked transport; separate owner-operated sandbox verification created one historical test order, verified approval and observed one completed capture. That private recording is retained locally and is not included in the public repository. No new transaction is needed for demonstration or routine tests.

## Phase 5: Evidence-linked investigation and replay — complete

**Deliverables:** deterministic incident detection, bounded evidence assembly, schema-validated local Qwen3 report, same-run citation validation, separate immutable report artifacts, evidence navigation and side-effect-free policy replay with original/what-if comparison.

**Acceptance:** Genuine quantity deviation is identified with cited evidence; a genuine completed authorized sandbox run is not falsely classified as an incident; a synthetic over-budget case stays labeled synthetic. Invalid, cross-run or unsupported model claims are rejected. Original data and payment claims remain unchanged. Replay makes zero external calls, including concurrent and repeated invocations.

**Dependencies and tests:** Frozen runs and policies. Unit/API/browser tests cover fact validation, failure/unavailable model states, citation navigation, deterministic comparison and network isolation. A separate local-model smoke accepted reports for the preserved private scenarios without financial calls. Optional model rerun remains deferred because it would introduce a separate nondeterministic workflow.

## Phase 6: Local guided experience — complete

**Deliverables:** read-only scenario explorer, four fixed scenario IDs, clear genuine/synthetic provenance, safe in-memory synthetic exercises, fixed read-only access to private archives when present, synthetic-only screenshots and reproducible clean-install instructions.

**Acceptance:** Fresh installation runs both synthetic exercises without an API key, model or private database. Genuine cards report unavailable when their archives are absent. Scenario switching does not merge recordings, mutate archives or create payments. Citation, filtering and comparison links reach the correct evidence. The viewer exposes no financial action.

**Dependencies and tests:** Existing Phase 1–5 contracts. The source-copy setup helper excludes local environment files and databases. Unit and browser tests verify API query restrictions, provenance, navigation, clean-checkout behavior and mobile layout.

## Interface refinement — complete

**Deliverables:** centralized blue palette, Geist/Geist Mono typography, shared spacing and focus treatment, grouped responsive navigation, consistent forms/dialogs/statuses, refined Black Box grid, investigation and replay views. Design tokens are in `src/app/tokens.css`; [design notes](DESIGN.md) describe the system.

**Acceptance:** Active navigation is clear; dense evidence remains readable on desktop and mobile; dialogs restore focus; pending/error states are visible; repeated clicks do not create duplicate UI submissions; citations select the exact event even after grid filtering. Application-owned copy has no en or em dashes.

**Verification:** 38 updated screenshots at 1440, 1280, 768 and 390px, with 18 original desktop/mobile captures for comparison. No page errors, external browser requests or horizontal page overflow in the final screenshot pass. The browser suite exercises route navigation, recording, shopping, policy editing, mock checkout, investigation, replay, grid interactions and demo links. No business logic, API or database schema changed in this visual pass.

## Public repository — published

- [x] Keep `.env.local`, `data/`, SQLite/WAL files, build output, browser traces and logs ignored.
- [x] Add [local setup](docs/SETUP.md) with official Ollama and Channel3 onboarding links, required environment names and no-key instructions.
- [x] Replace event-specific and provider-branded public copy with product-neutral descriptions while keeping the optional sandbox code and original recorded evidence intact.
- [x] Complete the public-file and secret scan, rerun all automated checks, inspect the screenshots and verify local documentation links.
- [x] Prepare and inspect an isolated local Git staging copy for the public file set.
- [x] Publish the reviewed release to the public `quicksparrow/rogue-agent-control` repository. No deployment has occurred.

## Verification log

| Check | Last confirmed result |
| --- | --- |
| `npm run typecheck` | Passed after interface refinement |
| `npm test` | **122/122** unit/API tests passed, zero failures |
| `npm run test:e2e` | **28/28** Chromium browser tests passed, including the original coverage and added interaction checks |
| `npm run build` | Passed optimized production build |
| Historical integrity | **916 original rows unchanged across four local databases** after interface work; original sandbox capture present and zero new payments |
| Credential audit | Configured keys absent from client assets and investigation artifacts; no raw tokens or buyer fields in exported artifacts |

**Public-copy update verification, November 17, 2026:** `npm run typecheck` passed; `npm test` passed **122/122**; `npm run build` passed; `npm run test:e2e` passed **28/28** against that production build. The first browser pass found one exact-heading assertion still expecting the old checkout text; its expected string was updated without changing its behavioral checks, and the complete rerun passed. The local Markdown-link audit found no missing targets. A case-insensitive scan found no removed provider or event name in public Markdown, `.env.example` or application-owned UI text. Public screenshots were visually checked; older branded before/after copies were removed from the distributable image directory, while the synthetic demo screenshots remain. The existing sensitive-data audit found no configured credentials in client assets or saved artifacts, no raw tokens or buyer fields in exported artifacts, and **zero new payments**. The historical-integrity check confirmed **916 original rows unchanged across four local databases**. Tests use mocks for provider flows; they do not verify a new transaction or a contributor's own API configuration.

**Publication audit, November 17, 2026:** An isolated ignored source copy installed **140 packages with zero npm advisories**, passed its production build and **122/122** unit/API tests, and served the no-key demo. In that copy, genuine private archive cards were unavailable and the synthetic quantity exercise was available. A local Git staging review included **132 files** and excluded `.env.local`, `data/`, dependencies, build output and browser artifacts. Four configured credential values were checked against staged text files without printing them; **zero matches** were found. Staged files matched the reviewed workspace by SHA-256, and `git diff --cached --check` passed. The reviewed release was published to the public `quicksparrow/rogue-agent-control` repository. Its `main` branch matched the local commit, and `.env.local` was absent from the public tree. Internal sandbox adapter identifiers and fixed private run references remain in source by the owner's public-UI-and-docs-only scope; the private recordings themselves are excluded.

## Known limits and roadmap

The current application is local and single-owner. It has no authentication, multi-tenant isolation, production authorization service, general human review resolution, complete tax/shipping/stock checks, real merchant fulfillment, webhook-driven recovery, cryptographic tamper resistance or supported hosted deployment. SQLite artifacts and private archive paths need a local backup strategy. No side-effect-free model rerun is offered.

Future work remains: stronger reliability and recovery; SDK/proxy instrumentation and trace export; approval ownership, case management, retention and role-based access; tenant isolation, backups, security review and operational deployment. None of these are silently represented as complete.
