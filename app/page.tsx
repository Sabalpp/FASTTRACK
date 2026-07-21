"use client";

import { BriefcaseBusiness, FileText, Users } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { roleLabels, roleOptions } from "@/lib/data-store";
import { Button } from "@/components/ui";
import { BackgroundPaperShaders } from "@/components/ui/background-paper-shaders";
import { branding } from "@/lib/branding";
import type { Role } from "@/lib/types";

const roleIconMap: Record<Role, typeof Users> = {
  owner: FileText,
  tech: BriefcaseBusiness,
  call_center: Users
};

export default function LoginPage() {
  const router = useRouter();
  const {
    signInAsRole,
    signInWithGoogle,
    verifyMfa,
    retryAuth,
    signOut,
    isDemoMode,
    isAuthenticated,
    authReady,
    authBusy,
    authError,
    currentUser,
    mfaRequired,
    canVerifyMfa
  } = useAuth();
  const [mfaCode, setMfaCode] = useState("");

  useEffect(() => {
    if (!isDemoMode && authReady && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [authReady, isAuthenticated, isDemoMode, router]);

  return (
    <main className="auth-screen">
      <BackgroundPaperShaders />
      <div className="auth-layout">
        <section className="auth-card">
          <div className="auth-logo">
            <Image
              src={branding.logoPath}
              alt={branding.businessName}
              width={88}
              height={69}
              priority
            />
          </div>
          <div className="auth-card-copy">
            <h1>Sign in</h1>
            <p>Use your approved Fast Track account.</p>
          </div>
          {authError ? <p className="error-message">{authError}</p> : null}

          {!isDemoMode && mfaRequired && canVerifyMfa ? (
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
              <Button type="submit" disabled={!mfaCode.trim() || authBusy}>
                {authBusy ? "Verifying..." : "Verify"}
              </Button>
            </form>
          ) : null}

          {!isDemoMode && mfaRequired ? (
            <div className="auth-form">
              {!canVerifyMfa ? (
                <button className="button" type="button" onClick={() => void retryAuth()} disabled={authBusy}>
                  {authBusy ? "Checking..." : "Retry access"}
                </button>
              ) : null}
              <button className="auth-secondary-link" type="button" onClick={() => void signOut()} disabled={authBusy}>
                Use a different Google account
              </button>
            </div>
          ) : null}

          {isDemoMode ? (
            <div className="auth-demo-panel">
              <p>Demo access</p>
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
            </div>
          ) : !mfaRequired ? (
            <>
              {isAuthenticated ? (
                <Button onClick={() => router.replace("/dashboard")} disabled>
                  Opening app...
                </Button>
              ) : (
                <button
                  className="google-auth-button"
                  type="button"
                  onClick={() => void signInWithGoogle()}
                  disabled={!authReady || authBusy}
                >
                  <GoogleIcon />
                  <span>{!authReady ? "Checking session..." : authBusy ? "Connecting..." : "Continue with Google"}</span>
                </button>
              )}
              {authError ? (
                <div className="auth-form">
                  <button className="auth-secondary-link" type="button" onClick={() => void retryAuth()} disabled={authBusy}>
                    Retry access
                  </button>
                  {currentUser.email ? (
                    <button className="auth-secondary-link" type="button" onClick={() => void signOut()} disabled={authBusy}>
                      Use a different Google account
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg className="google-mark" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path fill="#4285f4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z" />
      <path fill="#34a853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.83.86-3.05.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18z" />
      <path fill="#fbbc05" d="M3.95 10.7A5.41 5.41 0 0 1 3.67 9c0-.59.1-1.16.28-1.7V4.97H.94A9 9 0 0 0 0 9c0 1.45.34 2.82.94 4.03l3.01-2.33z" />
      <path fill="#ea4335" d="M9 3.58c1.32 0 2.5.45 3.43 1.35l2.58-2.58C13.45.9 11.43 0 9 0A9 9 0 0 0 .94 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}
