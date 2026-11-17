# Read-only guided demo architecture (Phase 6)

## API contract

`GET /api/demo?scenario=quantity|authorized|violation|practice` accepts exactly one enumerated scenario. Duplicate selectors, file paths, unknown fields and execution flags are rejected with 400. The existing local-origin check rejects foreign origins with 403. Other HTTP methods have no handler (405). No request can choose an arbitrary file, modify context, generate a report, replay a genuine payment, or invoke a provider.

The response includes `scenario`, `available`, `source`, and a provenance notice. Available snapshots add the existing redacted `RunDetail`, deterministic evidence package, an optional projection of a previously accepted investigation and an optional previously stored policy comparison. Source is one of `private_readonly_archive`, `isolated_synthetic`, `unavailable`. It is a local UI response, **not a public export contract**.

## Storage and provenance

`src/server/demo.ts` maps genuine scenarios to a fixed allowlist of private local archive paths and run IDs. It opens SQLite with `readonly:true`, `fileMustExist:true` and `query_only=ON`; it never constructs a migrating `BlackBoxStore` against an archive. Queries retrieve original receipt order, JSON events and separate stored artifacts. Existing pure evidence assembly is reused through a read-only detail projection. Archive failures are visible; genuine scenarios never fall back to fixtures. Missing original mandate references in legacy events are not invented.

Synthetic C uses the existing labeled archived fixture when available, otherwise a labeled isolated in-memory store. Practice is always isolated synthetic. The existing deterministic fixture builder/evaluator supplies actual rule results; no model outcome is fabricated. Memory snapshots are cached per process to keep event/citation IDs stable while navigating. They are not historical evidence, persistent payment capabilities or stable cross-restart public datasets.

There is **no migration v6**, database merge, genuine export or new payment operation. The read-only viewer only displays genuine stored comparisons/reports; the working investigation interface retains new-report and what-if editing capabilities. Pure evaluation and existing no-network replay tests remain unchanged.

## UI

`/demo` provides scenario selection, provenance, requested/proposed behavior, AG Grid Community exploration, evidence inspection, deterministic findings, archived Qwen3 fact selections and original/hypothetical comparison. Citations clear view filters and select the original event inspector. Sorting/filtering never changes stored order. Event/run/trace/parent IDs are filterable grid columns; timestamps and provenance remain visible. Desktop/mobile layouts share the existing sidebar and inspector. Historical payment stages are observations, without financial action buttons.

## Reset and setup safety

No new reset utility is needed for memory fixtures. The existing reset script is narrowed to an explicitly selected `data/disposable-demo[-name].sqlite` or `.db`; default/historical paths fail before deletion. The setup helper copies an explicit source allowlist into a new ignored directory; it does not copy environment files, database contents or build output. This is a local reproducibility check and not an approved release export.

## Verification boundary

Unit tests replace `fetch` with a throwing counter during fixture evaluation. Browser checks block/count external requests. The separate real-Ollama smoke allows only loopback `/api/tags`, `/api/show`, `/api/chat` and fails on all other requests; replay counters remain zero. Original rows are hashed before/after; new reports/replays may append as separate artifacts. Configured credentials are checked against client assets and investigation artifacts without printing their values.

These controls preserve the existing local single-owner boundary. They do not provide authentication, public archive authorization, cryptographic storage integrity, or a general-purpose evidence distribution service.
