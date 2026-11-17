"use client";

import { useEffect, useRef, useState } from "react";
import { X, FlaskConical, ArrowRight } from "lucide-react";
import type { Persona, Scenario } from "../lib/contracts";

export default function RecordingDialog({
  close,
  record,
  pending,
  error,
}: {
  close: () => void;
  record: (persona: Persona, scenario: Scenario) => Promise<void>;
  pending: boolean;
  error: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [persona, setPersona] = useState<Persona>("consumer");
  const [scenario, setScenario] = useState<Scenario>("deviation");
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="recording-dialog"
      aria-labelledby="recording-title"
      onCancel={(e) => {
        if (pending) e.preventDefault();
        else close();
      }}
    >
      <div className="dialog-heading">
        <span className="eyebrow">Local scenario recorder</span>
        <button
          className="icon-button"
          aria-label="Close recording dialog"
          onClick={close}
          disabled={pending}
        >
          <X size={19} />
        </button>
      </div>
      <h2 id="recording-title">Create a synthetic recording</h2>
      <p>
        Explore the Black Box with a controlled shopping scenario. Every
        generated event is labeled synthetic.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void record(persona, scenario);
        }}
      >
        <label className="field-label" htmlFor="persona">
          Shopping persona
        </label>
        <select
          id="persona"
          value={persona}
          onChange={(e) => setPersona(e.target.value as Persona)}
          disabled={pending}
        >
          <option value="consumer">
            Consumer · running shoes · $150 limit
          </option>
          <option value="business">
            Business buyer · office equipment · $1,000 limit
          </option>
        </select>
        <label className="field-label" htmlFor="scenario">
          Recorded outcome
        </label>
        <select
          id="scenario"
          value={scenario}
          onChange={(e) => setScenario(e.target.value as Scenario)}
          disabled={pending}
        >
          <option value="deviation">
            Mandate deviation · injected listing fixture
          </option>
          <option value="authorized">
            Within mandate · clean listing fixture
          </option>
        </select>
        <div className="fixture-notice">
          <FlaskConical size={18} />
          <span>
            No AI, Channel3, policy enforcement, or payment-provider calls. This records a
            fixture through the real SQLite event pipeline.
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary dialog-submit"
          type="submit"
          disabled={pending}
        >
          {pending ? "Recording…" : "Record synthetic scenario"}
          <ArrowRight size={17} />
        </button>
      </form>
    </dialog>
  );
}
