import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import "@fit/ui/styles.css";
import "./globals.css";

export const metadata: Metadata = { title: "Internal tools" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
