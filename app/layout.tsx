import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "@/components/AppProviders";
import { AppShell } from "@/components/AppShell";
import { branding } from "@/lib/branding";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: branding.businessName,
  description: "HVAC + Plumbing field service"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
