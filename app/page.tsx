"use client";

import { BriefcaseBusiness, FileText, LockKeyhole, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { branding } from "@/lib/branding";
import { roleLabels, roleOptions } from "@/lib/data-store";
import { Button } from "@/components/ui";
import type { Role } from "@/lib/types";

const roleIconMap: Record<Role, typeof Users> = {
  owner: FileText,
  tech: BriefcaseBusiness,
  call_center: Users
};

export default function LoginPage() {
  const router = useRouter();
  const { signInAsRole, signInWithGoogle, verifyMfa, isDemoMode, isAuthenticated, authReady, authError, currentUser, mfaRequired } = useAuth();
  const [mfaCode, setMfaCode] = useState("");

  return (
    <main className="auth-screen">
      <div className="auth-stars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <section className="auth-card">
        <div className="auth-mark" aria-hidden="true">
          <LockKeyhole size={22} />
        </div>
        <h1>{branding.businessName}</h1>
        {authError ? <p className="error-message">{authError}</p> : null}

        {!isDemoMode && mfaRequired ? (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              void verifyMfa(mfaCode);
            }}
          >
            <label className="field">
              <span>Authenticator code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={!mfaCode.trim()}>Verify</Button>
          </form>
        ) : null}

        {isDemoMode ? (
          <>
            <div className="role-login-grid role-login-grid-polished">
              {roleOptions.map((role) => {
                const Icon = roleIconMap[role];
                return (
                <button key={role} className={`role-login-button role-login-${role}`} onClick={() => signInAsRole(role)}>
                  <Icon size={18} aria-hidden="true" />
                  <strong>{role === "call_center" ? "Desk" : roleLabels[role]}</strong>
                </button>
                );
              })}
            </div>
          </>
        ) : !mfaRequired ? (
          <>
            {isAuthenticated ? (
              <Button onClick={() => router.push("/dashboard")}>Open app</Button>
            ) : (
              <button className="google-auth-button" type="button" onClick={() => void signInWithGoogle()} disabled={!authReady}>
                <span className="google-mark">G</span>
                <span>{authReady ? "Continue with Google" : "Checking session..."}</span>
              </button>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
