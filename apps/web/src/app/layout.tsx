import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Home Design Studio",
    template: "%s | Home Design Studio",
  },
  description:
    "A source-aware journey from home evidence to editable design options and an implementation handoff.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-GB">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
