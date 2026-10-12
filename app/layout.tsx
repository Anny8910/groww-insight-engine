import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GrowwChat — Review Intelligence & MCP Approval",
  description:
    "Turns raw customer reviews into a weekly product pulse + fee explainer, then logs to internal tools via approval-gated MCP.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}