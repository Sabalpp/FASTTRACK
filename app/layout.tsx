import type { Metadata } from "next";
import "./globals.css";
import "./phase5.css";
import { AppProviders } from "@/components/AppProviders";
import { AppShell } from "@/components/AppShell";
import { branding } from "@/lib/branding";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: branding.businessName,
  description: "Fast Track field service operations"
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
