import { ActionLink, StatePanel } from "../components/ui-primitives";

export default function NotFound() {
  return (
    <div className="state-layout">
      <StatePanel
        actions={
          <ActionLink href="/" tone="secondary">
            Return home
          </ActionLink>
        }
        message={
          <p>
            The address may be incomplete or the page may have moved. Return to the studio and
            continue from the main journey.
          </p>
        }
        status="Page not found"
        title="This room is not in the plan."
      />
    </div>
  );
}
