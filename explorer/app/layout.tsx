import type { Metadata } from "next";
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
        {children}
      </body>
    </html>
  );
}
