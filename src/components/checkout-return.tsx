"use client";
import { useEffect, useState } from "react";
import SandboxCheckout from "./sandbox-checkout";
import WorkspaceSidebar from "./workspace-sidebar";
import { ArrowLeft, ChevronRight, FileSearch } from "lucide-react";
export default function CheckoutReturn() {
  const [params, setParams] = useState<{ id: string; cancel: boolean } | null>(
    null,
  );
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setParams({
      id: p.get("proposal_id") ?? "",
      cancel: p.get("cancel") === "1",
    });
  }, []);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#checkout-main">
        Skip to checkout
      </a>
      <WorkspaceSidebar active="checkout" />
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>Sandbox checkout</strong>
          </span>
        </header>
        <main
          id="checkout-main"
          className="operations-main checkout-main"
          tabIndex={-1}
        >
          <div className="page-heading">
            <div>
              <h1>
                Sandbox checkout<span className="heading-dot">.</span>
              </h1>
              <p>
                Inspect the order, verify buyer approval and review the capture
                status.
              </p>
            </div>
          </div>
          {!params ? (
            <p className="form-note" role="status">
              Opening checkout…
            </p>
          ) : /^[a-zA-Z0-9_.:-]{1,96}$/.test(params.id) ? (
            <SandboxCheckout
              proposalId={params.id}
              returnFlow
              cancelFlow={params.cancel}
            />
          ) : (
            <section className="op-empty">
              <FileSearch size={24} aria-hidden="true" />
              <h2>Select a shopping proposal</h2>
              <p>
                Open a saved shopping run to view sandbox checkout for a
                specific proposal.
              </p>
            </section>
          )}
          <a className="button secondary op-return" href="/shopping">
            <ArrowLeft size={15} /> Return to shopping agent
          </a>
        </main>
      </div>
    </div>
  );
}
