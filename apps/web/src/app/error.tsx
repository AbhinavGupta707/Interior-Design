"use client";

import { ActionButton, ActionLink, StatePanel } from "../components/ui-primitives";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ reset }: ErrorPageProps) {
  return (
    <div className="state-layout">
      <StatePanel
        actions={
          <>
            <ActionButton onClick={reset}>Try this view again</ActionButton>
            <ActionLink href="/" tone="quiet">
              Return home
            </ActionLink>
          </>
        }
        message={
          <p>
            We could not prepare this view. Your source evidence and saved decisions are not changed
            by retrying.
          </p>
        }
        status="Temporary problem"
        title="The workspace needs another moment."
        tone="error"
      />
    </div>
  );
}
