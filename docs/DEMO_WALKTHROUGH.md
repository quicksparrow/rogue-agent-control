# Demo walkthrough

From the repository directory, run `npm ci`, then `npm run dev`. Open `http://127.0.0.1:3000/demo`. The two synthetic exercises require no model, API key or private database. Keep the application on loopback.

The scenario cards switch a read-only viewer. Each card identifies whether its evidence is a genuine archived recording or a synthetic fixture. Separate runs are never combined into one transaction.

## Portable exercise: budget violation

Select **Synthetic Policy Violation**. A $151 proposal under a $150 policy produces DENY through the deterministic Firewall. The source notice tells you whether the labeled preserved fixture or an in-memory fixture is being viewed. Click an event citation, inspect the persisted JSON, then use search and AG Grid Community column filters. No model, catalog or payment service is called.

## Portable exercise: quantity control

Select **Practice Quantity Controls**. The synthetic owner mandate asks for 10 units, while the synthetic proposal has quantity 1. Original REVIEW becomes a hypothetical DENY when strict matching is selected. The recorded proposal and original policy do not change. The comparison grants no execution authority.

## Optional private recordings

When the owner's original local archives are present, **AI Quantity Deviation** shows a genuine Qwen3 B2B run: the owner requested 10 mice and the model proposed one. The Black Box links show the original mandate, model action, Firewall REVIEW and cited investigation. The policy comparison changes the mismatch rule to DENY without executing an operation.

**Authorized Sandbox Purchase** is a separate genuine consumer recording. It shows ALLOW, order creation, buyer approval and confirmed capture as distinct historical observations. The deterministic investigator classifies the run as authorized execution. The viewer contains no create, approval, capture or reconciliation action. No new payment is needed to inspect it.

The private recordings are not bundled with the repository. On a clean checkout, their cards explicitly report unavailable. Do not copy a private environment file or genuine SQLite archive into a public repository merely to activate these cards.

## Follow the evidence

1. Select a scenario and read the provenance notice.
2. Open **Black Box** in the guided links. Click a citation to select the exact event; compare its event ID, timestamp, producer, source and stored JSON.
3. Open **Investigation** to distinguish deterministic observations from any archived local-model report. An archived report is not newly generated.
4. Open **Policy comparison** to inspect original and hypothetical decisions, changed rules and the explicit simulation boundary.

The sidebar also links to the working Black Box, Shopping Agent, Policy Firewall, Investigation and Sandbox Checkout. The guided viewer does not grant authority to those interfaces.

## Check a clean installation

The optional `scripts/fresh-install.ps1` helper makes a separate, ignored source copy under `data/` and prints its path. It excludes `.env.local`, local databases, dependencies and build output. In that copy, run `npm ci`, then `npm run dev -- --port 3102` and open `http://127.0.0.1:3102/demo`. The private cards should be unavailable; the two synthetic exercises should work.

No reset is needed for the portable exercises. The legacy reset utility refuses default and historical database paths. See [local setup](SETUP.md) for model and optional catalog configuration.
