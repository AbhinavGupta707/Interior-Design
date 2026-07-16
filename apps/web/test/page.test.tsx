import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ErrorPage from "../src/app/error";
import RootLayout from "../src/app/layout";
import Loading from "../src/app/loading";
import NotFound from "../src/app/not-found";
import HomePage from "../src/app/page";

describe("web shell contract", () => {
  it("renders one accessible route shell around the complete-home journey", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <HomePage />
      </RootLayout>,
    );

    expect(markup).toContain('<html lang="en-GB">');
    expect(markup).toContain('href="#main-content"');
    expect(markup).toContain('aria-label="Primary navigation"');
    expect(markup.match(/<main/g)).toHaveLength(1);
    expect(markup).toContain("Design your whole home with the evidence in view.");
    expect(markup).toContain("Bring the home together");
    expect(markup).toContain("Understand what is known");
    expect(markup).toContain("Develop design directions");
    expect(markup).toContain("Prepare to implement");
  });

  it("provides a polite, busy loading announcement", () => {
    const markup = renderToStaticMarkup(<Loading />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Preparing your home design workspace");
  });

  it("renders a useful not-found path back to the shell", () => {
    const markup = renderToStaticMarkup(<NotFound />);

    expect(markup).toContain("Page not found");
    expect(markup).toContain("This room is not in the plan.");
    expect(markup).toContain('href="/"');
    expect(markup).toContain("Return home");
  });

  it("offers recovery without claiming that source evidence changed", () => {
    const reset = vi.fn();
    const markup = renderToStaticMarkup(<ErrorPage error={new Error("test")} reset={reset} />);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Try this view again");
    expect(markup).toContain("source evidence and saved decisions are not changed");
    expect(reset).not.toHaveBeenCalled();
  });
});
