import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RESQ-AI // Drone Search & Rescue Command Center",
  description: "AI-Powered Autonomous Aerial Search & Rescue Mission Control for SIH 2026",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
