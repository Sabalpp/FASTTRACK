"use client";

import { AppDataProvider } from "@/lib/data-store";
import { AuthProvider } from "@/lib/auth";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AppDataProvider>
      <AuthProvider>{children}</AuthProvider>
    </AppDataProvider>
  );
}
