"use client";

import type { LocalPersona } from "@interior-design/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import { ActionButton, PageContainer } from "../../components/ui-primitives";
import { ClientProblem, signIn } from "./api";
import { personaOptions } from "./personas";

export function SignInScreen() {
  const router = useRouter();
  const [persona, setPersona] = useState<LocalPersona>("homeowner-alpha");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);
  const selectedName =
    personaOptions.find((option) => option.id === persona)?.displayName ?? "Avery Morgan";

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await signIn(persona);
      router.push("/projects");
    } catch (reason) {
      setError(
        reason instanceof ClientProblem
          ? reason.message
          : "The local fixture session could not be created. Try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <PageContainer className="auth-layout">
      <section className="auth-intro" aria-labelledby="sign-in-title">
        <h1 id="sign-in-title">Continue with a local fixture</h1>
        <p>
          For local development and testing only. These personas, projects and home details are
          visibly synthetic.
        </p>
        <div className="fixture-note" role="note">
          <strong>Local fixture</strong>
          <span>No provider key is required. Never enter a real address in this C1 build.</span>
        </div>
      </section>

      <form
        className="auth-form"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <fieldset disabled={submitting}>
          <legend>Choose a synthetic persona</legend>
          <p className="field-description" id="persona-description">
            Personas determine the fixture tenant and permissions on the server. The browser never
            sends tenant, user or role fields as authority.
          </p>
          <div className="persona-list" aria-describedby="persona-description">
            {personaOptions.map((option) => (
              <label
                className="persona-option"
                data-selected={persona === option.id}
                key={option.id}
              >
                <input
                  checked={persona === option.id}
                  name="persona"
                  onChange={() => {
                    setPersona(option.id);
                  }}
                  type="radio"
                  value={option.id}
                />
                <span>
                  <strong>{option.displayName}</strong>
                  <small>{option.roleLabel}</small>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {error ? (
          <div className="inline-alert" ref={errorRef} role="alert" tabIndex={-1}>
            <strong>Sign-in unavailable</strong>
            <span>{error}</span>
          </div>
        ) : null}

        <ActionButton className="auth-submit" disabled={submitting} type="submit">
          {submitting ? "Creating fixture session…" : `Continue as ${selectedName}`}
        </ActionButton>
      </form>
    </PageContainer>
  );
}
