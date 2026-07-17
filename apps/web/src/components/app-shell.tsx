import type { ReactNode } from "react";

import { ActionLink, PageContainer, SkipLink } from "./ui-primitives";

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <>
      <SkipLink />
      <header className="site-header">
        <PageContainer className="site-header__inner">
          <a aria-label="Home Design Studio, home" className="brand" href="/">
            <span aria-hidden="true" className="brand__mark">
              <span />
              <span />
              <span />
              <span />
            </span>
            <span>Home Design Studio</span>
          </a>
          <nav aria-label="Primary navigation" className="site-navigation">
            <a href="/#journey">Journey</a>
            <a href="/#principles">Principles</a>
            <a href="/projects">Projects</a>
          </nav>
          <ActionLink className="site-header__action" href="/sign-in" tone="secondary">
            Local fixture sign in
          </ActionLink>
        </PageContainer>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <PageContainer className="site-footer__inner">
          <p>Home Design Studio</p>
          <p>Designed for informed decisions, with uncertainty kept visible.</p>
        </PageContainer>
      </footer>
    </>
  );
}
