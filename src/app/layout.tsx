import type { Metadata } from "next";
import "./tokens.css";
import "./globals.css";
import "./workspace.css";
import "./operations.css";
import "./evidence-workspace.css";

export const metadata: Metadata = {
  title: "Black Box · Rogue Agent Control",
  description:
    "Evidence-first investigation for autonomous shopping agents. Shopping mandates, policy decisions and recorded evidence.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
