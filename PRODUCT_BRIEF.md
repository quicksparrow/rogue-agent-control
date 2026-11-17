# Rogue Agent Control: product and engineering brief

## Product decision

Rogue Agent Control is an open-source investigation and safety layer for autonomous consumer and B2B shopping agents. It records evidence behind consequential actions, helps a person reconstruct a deviation from the original purchasing mandate, and enforces independently configured controls before a side-effecting tool can run.

**Black Box is the centerpiece.** The Policy Firewall and deterministic replay complete the loop: observe a proposal, explain it with evidence, and test how an alternative control would have changed the authorization decision.

The product covers shopping and purchasing assistants only. It does not include refund, dispute, customer-support or seller-operations agents.

### Users and scenarios

The primary user is a developer or product team responsible for a shopping agent. They need to understand failures, demonstrate what the buyer authorized and prevent the agent from exceeding that authority. A consumer or business buyer is the secondary user who needs a clear explanation of unexpected actions.

| Persona | Original instruction | Example deviation | Independent control |
| --- | --- | --- | --- |
| Consumer | Find running shoes under $150 from an approved seller | Agent proposes a $349 item or unverified seller | Transaction cap and trusted merchant allowlist |
| Business buyer | Source 10 wireless mice within a $1,000 budget | Agent proposes one mouse | Quantity rule, budget and approval gate |

Both personas use the same runtime, event contracts, policy evaluator and investigation views. Only the mandate and policy bundle differ. Actual model-generated deviations must never be relabeled as synthetic, and fixtures must never be presented as actual model or payment behavior.

## Complete product loop

1. **Authorize:** The application captures the owner's original shopping mandate, explicit restrictions, owner identity and immutable policy version outside the agent's editable context.
2. **Observe:** The Black Box records model/tool steps, catalog results, proposed purchases, policy decisions, gateway eligibility, sandbox lifecycle observations and visibility gaps with timestamps, provenance and correlation IDs.
3. **Investigate:** Deterministic findings identify deviations and policy outcomes. A local Qwen3 investigator may organize bounded, schema-validated facts with citations to stored events, separate from hypotheses and missing information.
4. **Control:** A trusted server gateway resolves the original mandate and policy, evaluates deterministic budget, currency, merchant, quantity and approval rules, persists ALLOW/DENY/REVIEW, and blocks execution without explicit authority.
5. **Replay:** A pure evaluator checks the identical recorded proposal against its original frozen context and a hypothetical policy. It cannot contact shopping or payment services, rewrite evidence or authorize a real transaction. An optional model rerun is a separate, nondeterministic experiment and remains deferred.

The system cannot read private model thoughts, prove causality merely from event order, detect every malicious instruction, or stop an agent that operates outside its trusted gateway. Those gaps must be stated plainly.

## Demonstration paths

- **Genuine quantity deviation:** A preserved local Qwen3 B2B recording contains a mandate for 10 mice and proposals for one. The historical Firewall decision is REVIEW. A hypothetical strict-quantity replay returns DENY; the original evidence remains unchanged.
- **Genuine authorized sandbox execution:** A separate preserved local consumer recording shows ALLOW, test order creation, buyer approval and completed capture as distinct observations. It is classified as authorized behavior, not automatically as an incident. No new order is needed to inspect it.
- **Controlled synthetic violation:** A labeled fixture proposes $151 under a $150 cap and returns DENY. The user can follow the exact event evidence without a model, API key or financial service.
- **Portable quantity exercise:** A labeled in-memory 10-to-1 mismatch compares REVIEW with hypothetical DENY. It is never presented as the genuine Qwen3 run.

The two genuine archives are private local data and are not distributed with the source. Their cards must report unavailable on a clean checkout. The application must not silently substitute fixtures for actual integrations.

## Functional requirements

| ID | Capability | Acceptance criterion |
| --- | --- | --- |
| FR-01 | B2C/B2B mandates | Owner supplies task, quantity, budget, currency and merchant restrictions; immutable application-owned records persist |
| FR-02 | Shopping agent | Local open model makes actual tool-use and product decisions; its original proposal is preserved even when it violates constraints |
| FR-03 | Catalog | Seeded catalog works offline; optional Channel3 mode makes genuine read-only product-search calls and reports failures explicitly |
| FR-04 | Trusted gateway | Side-effecting operations resolve server-owned identity, mandate, policy and proposal; model/UI text cannot grant authority |
| FR-05 | Policy Firewall | Integer-minor-unit budget math, trusted merchant mapping, currency, quantity and approval controls produce one explicit ALLOW/DENY/REVIEW decision |
| FR-06 | Black Box | Timeline and Community grid show ordered, correlated, redacted evidence and known visibility gaps |
| FR-07 | Investigation | Deterministic findings and validated local-model reports cite only supported facts and same-run events; invalid reports fail visibly |
| FR-08 | Sandbox lifecycle | Test order creation, buyer approval, capture, failure and unresolved reconciliation remain separate recorded states; no live mode |
| FR-09 | Policy replay | Identical proposal plus frozen context yields repeatable rule results with zero external calls or historical changes |
| FR-10 | Guided demo | Newcomer can use no-key synthetic scenarios; private genuine archives remain optional and clearly marked |
| FR-11 | Reproducibility | Fresh local install needs no paid runtime service or external LLM key; optional credentials are server-only |
| FR-12 | Security | Redaction before storage/model input, fail-closed control, idempotency, no credentials in client assets and no payment access from replay |

## Architecture

- **Next.js, React and TypeScript:** local UI, API routes, scenario viewer and investigation/replay interactions.
- **SQLite:** runs, immutable mandates and policy versions, correlated events, payment state references, and separate investigation/replay artifacts. The original evidence is never rewritten for a report or simulation.
- **Ollama with Qwen3 4B:** local shopping and investigator model. No cloud LLM service is required.
- **Seeded catalog and optional Channel3:** the seeded mode is deterministic; live catalog content is untrusted and never establishes merchant checkout identity by itself.
- **Policy Firewall and trusted gateway:** application-owned deterministic evaluation precedes any side effect. REVIEW is blocked pending a separately authorized action. A test-only disabled-control fixture cannot reach real financial operations.
- **AG Grid Community:** evidence exploration with sorting, filtering, selection and exact event navigation. No Enterprise module is required.
- **Sandbox payment adapter:** optional, server-only demonstration boundary. It does not imply a purchase from a catalog retailer or real-world fulfillment.

```text
Owner mandate + frozen policy
            |
Qwen3 agent -> catalog adapter -> preserved proposal
                                        |
                                  trusted gateway
                                        |
                             deterministic Firewall
                              /        |        \
                           ALLOW     REVIEW     DENY
                             |          |         |
                        eligible    blocked   blocked
                             |
                    optional sandbox adapter
                             |
                    redacted Black Box evidence
                             |
                    investigation + pure replay
```

Events have stable event/run/trace IDs, parent references, producer and collector timestamps, schema versions, tool summaries and provenance. Model reports are separately stored with evidence digests, fact references, model/schema versions and uncertainty. Agent-supplied merchant names, permissions and approvals are untrusted.

## Local configuration and secrets

The synthetic demo needs no environment file. For a new local model run, install Ollama, pull `qwen3:4b` and use a loopback listener. Optional Channel3 search uses a server-only `CHANNEL3_API_KEY`. Exact setup steps and official links are in [docs/SETUP.md](docs/SETUP.md); placeholders are in `.env.example`.

Never commit `.env.local`, credentials, buyer information, private SQLite files, raw provider responses or logs. Do not put secrets in browser variables, model prompts or event payloads. A public repository should contain only synthetic screenshots and reviewed source/documentation. This local prototype is not an authenticated production financial service.

## Implementation sequence and remaining work

The implementation plan records the completed work and actual verification evidence. Its order began with Black Box, then added the shopping agent, deterministic Firewall, sandbox boundary, investigation/replay and the guided local demo. Each step was tested before the next. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the current state and limitations.

Further work remains in four areas:

1. **Reliability:** broader adversarial fixtures, durable recovery, reconciliation, account-wide budgets and explicit review resolution.
2. **Interoperability:** instrumented SDK or proxy adapters for other agent frameworks, standard trace export and storage portability.
3. **Governance:** approval ownership, policy diffing, retention, case management, audit integrity and role-based access control.
4. **Scale:** tenant isolation, backup/restore, observability, security review and controlled deployment.

Success measures include unauthorized action block rate, false review escalation rate, evidence completeness, investigation time, unsupported explanation rate, replay consistency and gateway latency. These are proposed metrics, not measured production claims.

## Primary references

- [Ollama installation](https://ollama.com/download) and [Qwen3 4B model](https://ollama.com/library/qwen3%3A4b)
- [Channel3 developer onboarding](https://channel3.ai/developers) and [API documentation](https://channel3.ai/docs)
- [AG Grid Community](https://www.ag-grid.com/eula/community/)
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
