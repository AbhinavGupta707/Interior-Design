import {
  getActionAttributes,
  getStateAnnouncementAttributes,
  loadingAnnouncementAttributes,
  uiClassNames,
} from "@interior-design/ui";
import type { ActionTone, StateTone } from "@interior-design/ui";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

function classNames(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}

export interface ActionLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  children: ReactNode;
  href: string;
  tone?: ActionTone;
}

export function ActionLink({
  children,
  className,
  href,
  tone = "primary",
  ...props
}: ActionLinkProps) {
  return (
    <a href={href} {...props} {...getActionAttributes({ className, tone })}>
      {children}
    </a>
  );
}

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  tone?: ActionTone;
}

export function ActionButton({
  children,
  className,
  tone = "primary",
  type = "button",
  ...props
}: ActionButtonProps) {
  return (
    <button type={type} {...props} {...getActionAttributes({ className, tone })}>
      {children}
    </button>
  );
}

export type PageContainerProps = HTMLAttributes<HTMLDivElement>;

export function PageContainer({ className, ...props }: PageContainerProps) {
  return <div className={classNames(uiClassNames.container, className)} {...props} />;
}

export interface SkipLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  children?: ReactNode;
  targetId?: string;
}

export function SkipLink({
  children = "Skip to main content",
  className,
  targetId = "main-content",
  ...props
}: SkipLinkProps) {
  return (
    <a href={`#${targetId}`} {...props} className={classNames(uiClassNames.skipLink, className)}>
      {children}
    </a>
  );
}

export interface StatePanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  message: ReactNode;
  status?: ReactNode;
  title: ReactNode;
  tone?: StateTone;
}

export function StatePanel({
  actions,
  className,
  message,
  status,
  title,
  tone = "neutral",
  ...props
}: StatePanelProps) {
  return (
    <section
      {...props}
      className={classNames(uiClassNames.statePanel, className)}
      data-tone={tone}
      {...getStateAnnouncementAttributes(tone)}
    >
      {status ? <p className={uiClassNames.statePanelStatus}>{status}</p> : null}
      <h1 className={uiClassNames.statePanelTitle}>{title}</h1>
      <div className={uiClassNames.statePanelMessage}>{message}</div>
      {actions ? <div className={uiClassNames.statePanelActions}>{actions}</div> : null}
    </section>
  );
}

export interface LoadingIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
}

export function LoadingIndicator({ className, label, ...props }: LoadingIndicatorProps) {
  return (
    <div
      {...props}
      {...loadingAnnouncementAttributes}
      className={classNames(uiClassNames.loading, className)}
    >
      <span aria-hidden="true" className={uiClassNames.loadingIndicator} />
      <span>{label}</span>
    </div>
  );
}
