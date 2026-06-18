"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/lib/data-store";
import { demoMode, googleAuthEnabled, ownerMfaRequired } from "@/lib/runtime";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { AllowedUser, Role } from "@/lib/types";

const CURRENT_USER_KEY = "hvac-plumbing-mvp-current-user-id";

const signedOutUser: AllowedUser = {
  id: "signed-out",
  email: "",
  role: "call_center",
  displayName: "Signed out",
  active: false,
  createdAt: ""
};

type AuthContextValue = {
  currentUser: AllowedUser;
  setCurrentUserId: (id: string) => void;
  signInAsRole: (role: Role) => void;
  signInWithGoogle: () => Promise<void>;
  verifyMfa: (code: string) => Promise<void>;
  signOut: () => void;
  loginPath: string;
  isDemoMode: boolean;
  isAuthenticated: boolean;
  authReady: boolean;
  mfaRequired: boolean;
  authError?: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const supabase = useMemo(() => (demoMode ? null : getSupabaseBrowserClient()), []);
  const { allowedUsers, loaded: dataLoaded, lastError: dataError } = useAppData();
  const owner = allowedUsers.find((user) => user.role === "owner" && user.active) ?? allowedUsers[0] ?? signedOutUser;
  const [currentUserId, setCurrentUserIdState] = useState(owner.id);
  const [sessionEmail, setSessionEmail] = useState<string | undefined>();
  const [authReady, setAuthReady] = useState(demoMode);
  const [explicitAuthError, setExplicitAuthError] = useState<string | undefined>();
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | undefined>();
  const [mfaChecked, setMfaChecked] = useState(demoMode);

  useEffect(() => {
    if (!demoMode) return;

    const stored = window.localStorage.getItem(CURRENT_USER_KEY);
    if (stored && allowedUsers.some((user) => user.id === stored && user.active)) {
      setCurrentUserIdState(stored);
    }
  }, [allowedUsers]);

  useEffect(() => {
    if (demoMode) return;

    const client = supabase;
    if (!client) {
      setExplicitAuthError("Supabase Auth is not configured.");
      setAuthReady(true);
      return;
    }
    const authClient: NonNullable<typeof client> = client;

    let cancelled = false;

    async function loadSession() {
      const { data, error } = await authClient.auth.getSession();
      if (cancelled) return;

      if (error) {
        setExplicitAuthError(error.message);
        setSessionEmail(undefined);
      } else {
        setExplicitAuthError(undefined);
        setSessionEmail(data.session?.user.email ?? undefined);
        setMfaChecked(!data.session);
      }
      setAuthReady(true);
    }

    void loadSession();
    const {
      data: { subscription }
    } = authClient.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user.email ?? undefined);
      setMfaChecked(!session);
      setExplicitAuthError(undefined);
      setAuthReady(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const productionUser = useMemo(() => {
    if (!sessionEmail) return signedOutUser;

    const allowedUser = allowedUsers.find((user) => user.active && user.email.toLowerCase() === sessionEmail.toLowerCase());
    return allowedUser ?? {
      ...signedOutUser,
      email: sessionEmail,
      displayName: sessionEmail
    };
  }, [allowedUsers, sessionEmail]);

  const currentUser = demoMode
    ? allowedUsers.find((user) => user.id === currentUserId && user.active) ?? owner
    : productionUser;

  useEffect(() => {
    if (demoMode) return;

    const client = supabase;
    if (!client || !sessionEmail || !productionUser.active) {
      setMfaRequired(false);
      setMfaFactorId(undefined);
      setMfaChecked(true);
      return;
    }

    if (!ownerMfaRequired || productionUser.role !== "owner") {
      setMfaRequired(false);
      setMfaFactorId(undefined);
      setMfaChecked(true);
      return;
    }

    const authClient = client;
    let cancelled = false;

    async function checkMfa() {
      setMfaChecked(false);
      const { data: aalData, error: aalError } = await authClient.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;

      if (aalError) {
        setExplicitAuthError(aalError.message);
        setMfaRequired(true);
        setMfaChecked(true);
        return;
      }

      if (aalData.currentLevel === "aal2") {
        setMfaRequired(false);
        setMfaFactorId(undefined);
        setMfaChecked(true);
        return;
      }

      const { data: factorData, error: factorError } = await authClient.auth.mfa.listFactors();
      if (cancelled) return;

      if (factorError) {
        setExplicitAuthError(factorError.message);
        setMfaRequired(true);
        setMfaChecked(true);
        return;
      }

      const factor = factorData.totp[0] ?? factorData.all.find((candidate) => candidate.factor_type === "totp" && candidate.status === "verified");
      setMfaFactorId(factor?.id);
      setMfaRequired(true);
      setExplicitAuthError(factor ? undefined : "Owner access requires an enrolled authenticator factor.");
      setMfaChecked(true);
    }

    void checkMfa();

    return () => {
      cancelled = true;
    };
  }, [productionUser.active, productionUser.role, sessionEmail, supabase]);

  const authError = useMemo(() => {
    if (demoMode) return undefined;
    if (explicitAuthError) return explicitAuthError;
    if (dataError) {
      if (dataError.toLowerCase().includes("jwt issued at future")) {
        return "Supabase is syncing the Google session. Wait a few seconds, then refresh.";
      }
      return dataError;
    }
    if (sessionEmail && dataLoaded && !productionUser.active) {
      return `${sessionEmail} is not on the Fast Track allowlist. Ask an owner to add or reactivate this account.`;
    }
    return undefined;
  }, [dataError, dataLoaded, explicitAuthError, productionUser.active, sessionEmail]);

  const value = useMemo<AuthContextValue>(() => {
    function setCurrentUserId(id: string) {
      if (!demoMode) return;
      window.localStorage.setItem(CURRENT_USER_KEY, id);
      setCurrentUserIdState(id);
    }

    async function signInWithGoogle() {
      if (demoMode) {
        router.push("/dashboard");
        return;
      }

      if (!supabase) {
        setExplicitAuthError("Supabase Auth is not configured.");
        return;
      }

      if (!googleAuthEnabled) {
        setExplicitAuthError("Google auth is disabled by NEXT_PUBLIC_ENABLE_GOOGLE_AUTH.");
        return;
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
          queryParams: {
            prompt: "select_account"
          }
        }
      });
      if (error) setExplicitAuthError(error.message);
    }

    async function verifyMfa(code: string) {
      if (demoMode || !supabase || !mfaFactorId) return;

      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: mfaFactorId,
        code
      });

      if (error) {
        setExplicitAuthError(error.message);
        return;
      }

      setExplicitAuthError(undefined);
      setMfaRequired(false);
      router.push("/dashboard");
    }

    function signInAsRole(role: Role) {
      if (!demoMode) {
        void signInWithGoogle();
        return;
      }

      const next = allowedUsers.find((user) => user.role === role && user.active);
      if (!next) return;
      setCurrentUserId(next.id);
      router.push("/dashboard");
    }

    function signOut() {
      if (demoMode) {
        window.localStorage.removeItem(CURRENT_USER_KEY);
        router.push("/");
        return;
      }

      if (!supabase) {
        router.push("/");
        return;
      }

      void supabase.auth.signOut().finally(() => {
        setSessionEmail(undefined);
        router.push("/");
      });
    }

    return {
      currentUser,
      setCurrentUserId,
      signInAsRole,
      signInWithGoogle,
      verifyMfa,
      signOut,
      loginPath: "/",
      isDemoMode: demoMode,
      isAuthenticated: demoMode ? currentUser.active : Boolean(sessionEmail && productionUser.active && !mfaRequired),
      authReady: demoMode || (authReady && dataLoaded && mfaChecked),
      mfaRequired,
      authError
    };
  }, [allowedUsers, authError, authReady, currentUser, dataLoaded, mfaChecked, mfaFactorId, mfaRequired, productionUser.active, router, sessionEmail, supabase]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
