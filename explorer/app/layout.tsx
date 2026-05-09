// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Limen Graph Explorer",
  description: "Visualize the Limen knowledge graph",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-[#0a0a0f] text-gray-200 overflow-hidden">
        <nav className="h-10 flex items-center gap-6 px-4 border-b border-[#1e1e2e] bg-[#0d0d14] shrink-0">
          <span className="text-xs font-semibold text-gray-400 tracking-wide uppercase">Limen Explorer</span>
          <Link href="/" className="text-xs text-gray-400 hover:text-white transition-colors">
            Graph
          </Link>
          <Link href="/refusals" className="text-xs text-gray-400 hover:text-white transition-colors">
            Refusals
          </Link>
          <Link href="/versions" className="text-xs text-gray-400 hover:text-white transition-colors">
            Versions
          </Link>
        </nav>
        <div className="h-[calc(100vh-2.5rem)]">
          {children}
        </div>
      </body>
    </html>
  );
}
