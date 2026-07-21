"use client";

import { AuthProvider } from "@/lib/auth";
import { AppDataProvider, useAppData } from "@/lib/data-store";
import { demoMode } from "@/lib/runtime";

export function AppProviders({ children }: { children: React.ReactNode }) {
  if (demoMode) {
    return (
      <AppDataProvider>
        <DemoAuthBridge>{children}</DemoAuthBridge>
      </AppDataProvider>
    );
  }

  return (
    <AuthProvider>
      <AppDataProvider>{children}</AppDataProvider>
    </AuthProvider>
  );
}

function DemoAuthBridge({ children }: { children: React.ReactNode }) {
  const { allowedUsers } = useAppData();
  return <AuthProvider demoAllowedUsers={allowedUsers}>{children}</AuthProvider>;
}
