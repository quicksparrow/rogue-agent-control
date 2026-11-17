import { ShieldCheck, ShieldAlert, Clock3 } from "lucide-react";
import type { FirewallView } from "../lib/firewall-contracts";
import SandboxCheckout from "./sandbox-checkout";

export default function FirewallStatus({
  view,
  fixture = false,
}: {
  view?: FirewallView;
  fixture?: boolean;
}) {
  if (!view)
    return (
      <div className="historical-policy-note">
        Historical research recording. The agent ran before Firewall
        enforcement.
      </div>
    );
  return (
    <section className="firewall-status" aria-label="Policy Firewall decisions">
      <div className="firewall-status-heading">
        <ShieldCheck size={18} />
        <strong>Policy Firewall</strong>
        <span className="badge neutral">Server evaluation</span>
      </div>
      <p className="form-note">
        {fixture
          ? "Real evaluation of a controlled synthetic proposal. No model ran."
          : "Original proposals evaluated against this run’s immutable mandate, owner policy and merchant registry."}{" "}
        Sandbox checkout rechecks authority and transaction details after an
        ALLOW.
      </p>
      {!view.proposals.length && (
        <p className="policy-pending">
          No proposed action has reached the Firewall yet. Execution is not
          authorized by this screen.
        </p>
      )}
      {view.proposals.map((proposal) => {
        const decision = view.decisions.find(
          (d) => d.proposal_id === proposal.proposal_id,
        );
        return (
          <article
            key={proposal.proposal_id}
            className="decision-card"
            aria-label={`Policy decision: ${decision?.outcome ?? "MISSING"}`}
          >
            <div className="decision-heading">
              <span
                className={`outcome-badge ${decision?.outcome.toLowerCase() ?? "deny"}`}
              >
                {decision?.outcome === "ALLOW" ? (
                  <ShieldCheck size={15} />
                ) : decision?.outcome === "REVIEW" ? (
                  <Clock3 size={15} />
                ) : (
                  <ShieldAlert size={15} />
                )}
                {decision?.outcome ?? "NO DECISION"}
              </span>
              <span>
                {decision?.outcome === "ALLOW"
                  ? "Eligible for next gateway stage · no execution"
                  : decision?.outcome === "REVIEW"
                    ? "Human review required · execution blocked"
                    : "Execution blocked"}
              </span>
            </div>
            <p className="decision-reasons">
              {decision?.reason_codes
                .map((reason) => reason.replaceAll("_", " ").toLowerCase())
                .join(" · ") ?? "Missing decision evidence. Fail closed."}
            </p>
            <details>
              <summary>Decision, rules and immutable references</summary>
              {decision ? (
                <dl className="product-references">
                  <dt>Decision ID</dt>
                  <dd>{decision.decision_id}</dd>
                  <dt>Proposal</dt>
                  <dd>{decision.proposal_id}</dd>
                  <dt>Run</dt>
                  <dd>{decision.run_id}</dd>
                  <dt>Mandate</dt>
                  <dd>{decision.mandate_id}</dd>
                  <dt>Agent / owner</dt>
                  <dd>
                    {decision.agent_id} / {decision.owner_id}
                  </dd>
                  <dt>Policy ID</dt>
                  <dd>{decision.policy_id}</dd>
                  <dt>Policy version</dt>
                  <dd>{decision.policy_version}</dd>
                  <dt>Owner version</dt>
                  <dd>{decision.owner_policy_version}</dd>
                  <dt>Registry</dt>
                  <dd>{decision.registry_version}</dd>
                  <dt>Timestamp</dt>
                  <dd>{decision.timestamp}</dd>
                  <dt>Rules evaluated</dt>
                  <dd>{decision.rule_ids.join(", ")}</dd>
                </dl>
              ) : (
                <p>
                  Inspect visibility notes in Black Box before treating any
                  action as authorized.
                </p>
              )}
            </details>
            <SandboxCheckout proposalId={proposal.proposal_id} />
          </article>
        );
      })}
      <p className="form-note">
        Proposals in REVIEW stay blocked pending independent approval.
      </p>
    </section>
  );
}
