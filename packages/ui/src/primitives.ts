export const actionTones = ["primary", "secondary", "quiet"] as const;
export type ActionTone = (typeof actionTones)[number];

export const stateTones = ["neutral", "error"] as const;
export type StateTone = (typeof stateTones)[number];

export const uiClassNames = {
  action: "ui-action",
  container: "ui-container",
  loading: "ui-loading",
  loadingIndicator: "ui-loading__indicator",
  skipLink: "ui-skip-link",
  statePanel: "ui-state-panel",
  statePanelActions: "ui-state-panel__actions",
  statePanelMessage: "ui-state-panel__message",
  statePanelStatus: "ui-state-panel__status",
  statePanelTitle: "ui-state-panel__title",
} as const;

function classNames(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}

export interface ActionAttributesOptions {
  className?: string | undefined;
  tone?: ActionTone;
}

export function getActionAttributes({ className, tone = "primary" }: ActionAttributesOptions = {}) {
  return {
    className: classNames(uiClassNames.action, className),
    "data-tone": tone,
  } as const;
}

export function getStateAnnouncementAttributes(tone: StateTone) {
  return tone === "error" ? ({ "aria-live": "assertive", role: "alert" } as const) : ({} as const);
}

export const loadingAnnouncementAttributes = {
  "aria-busy": "true",
  "aria-live": "polite",
  role: "status",
} as const;
