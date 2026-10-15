import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fit/ui/styles.css";
import "./globals.css";

export const metadata: Metadata = { title: "Internal tools" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
