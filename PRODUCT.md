# Product context

<!-- impeccable:product-schema 1 -->

`PRODUCT_BRIEF.md` is the complete, authoritative product specification. This short UI context does not replace it. The user's current instruction moves Black Box to implementation Phase 1; see `IMPLEMENTATION_PLAN.md` for the mapping.

## Platform

web

## Stack

Next.js / React, TypeScript on Node.js, SQLite and AG Grid Community. Local Qwen3 4B runs through Ollama; optional Channel3 supplies product discovery. A server-owned sandbox payment adapter demonstrates the authorization boundary.

## Users

Shopping-agent developers and product teams investigate consequential actions. Consumers and business buyers need evidence of what they authorized and what their shopping agent did.

## Product Purpose

Record evidence, reconstruct failures, enforce independent controls, and replay proposals safely. Black Box is the centerpiece.

## Capabilities and Constraints

Only consumer and B2B shopping agents. Preserve the complete brief roadmap. Phase 1 is local event capture, durable SQLite storage, and interactive investigation timeline. Phase 2 adds actual Ollama/Qwen3 shopping research, seeded and optional live Channel3 search, immutable application-owned mandates/policies, and server instrumentation. Synthetic fixtures remain labeled and separate. No credentials or private model thinking in persisted evidence; mandate text is a bounded sanitized task contract. No checkout, enforcement, replay, deployment or GitHub push in Phase 2.

## Evidence on Hand

The brief is authoritative. Phase 1 verification covers synthetic/external recording. Phase 2 verification results, including separately observed real-model and live catalog runs, belong in IMPLEMENTATION_PLAN.md. There are no payment transactions in either phase.

## Product Principles

- Stored evidence precedes generated explanations.
- Distinguish observation, simulation, and uncertainty.
- Keep deterministic policy replay separate from nondeterministic model reruns.
- Prefer reproducible, free, open-source local dependencies.

## Open decisions

Model split, instrumentation packaging, advanced approvals, hosted demo, catalog licensing, and naming remain deferred as in the brief. Initial UI composition is an implementation choice under the user's instruction to proceed without blockers.
