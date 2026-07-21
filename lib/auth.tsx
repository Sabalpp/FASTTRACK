"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import { OperationTimeoutError, wait, withTimeout } from "@/lib/async-utils";
import { demoMode, googleAuthEnabled, ownerMfaRequired } from "@/lib/runtime";
import { allowedUserFromRow } from "@/lib/supabase-mappers";
import { clearSupabaseBrowserSessionStorage, getSupabaseBrowserClient } from "@/lib/supabase";
import type { AllowedUser, Role } from "@/lib/types";

const CURRENT_USER_KEY = "hvac-plumbing-mvp-current-user-id";
const EXPLICIT_SIGN_OUT_KEY = "hvac-plumbing-mvp-explicit-sign-out";
const AUTH_OPERATION_TIMEOUT_MS = 12_000;
const AUTH_RESOLUTION_TIMEOUT_MS = 20_000;
const AUTH_INITIALIZATION_TIMEOUT_MS = 18_000;

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
  sessionUserId?: string;
  sessionRevision: number;
  setCurrentUserId: (id: string) => void;
  signInAsRole: (role: Role) => void;
  signInWithGoogle: () => Promise<void>;
  verifyMfa: (code: string) => Promise<void>;
  retryAuth: () => Promise<void>;
  signOut: () => Promise<void>;
  loginPath: string;
  isDemoMode: boolean;
  isAuthenticated: boolean;
  authReady: boolean;
  authBusy: boolean;
  mfaRequired: boolean;
  canVerifyMfa: boolean;
  authError?: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthProviderProps = {
  children: React.ReactNode;
  demoAllowedUsers?: AllowedUser[];
};

export function AuthProvider({ children, demoAllowedUsers = [] }: AuthProviderProps) {
  const router = useRouter();
  const supabase = useMemo(() => (demoMode ? null : getSupabaseBrowserClient()), []);
  const owner = demoAllowedUsers.find((user) => user.role === "owner" && user.active) ?? demoAllowedUsers[0] ?? signedOutUser;
  const [currentUserId, setCurrentUserIdState] = useState(owner.id);
  const [productionUser, setProductionUser] = useState<AllowedUser>(signedOutUser);
  const [sessionUserId, setSessionUserId] = useState<string | undefined>();
  const [sessionRevision, setSessionRevision] = useState(0);
  const [authReady, setAuthReady] = useState(demoMode);
  const [authBusy, setAuthBusy] = useState(false);
  const [explicitAuthError, setExplicitAuthError] = useState<string | undefined>();
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | undefined>();
  const authRunRef = useRef(0);
  const queuedSessionKeyRef = useRef<string | undefined>(undefined);
  const activeSessionUserIdRef = useRef<string | undefined>(undefined);
  const authAccessControllerRef = useRef<AbortController | undefined>(undefined);
  const authSettledRef = useRef(demoMode);

  useEffect(() => {
    if (!demoMode) return;

    const stored = window.localStorage.getItem(CURRENT_USER_KEY);
    if (stored && demoAllowedUsers.some((user) => user.id === stored && user.active)) {
      setCurrentUserIdState(stored);
    }
  }, [demoAllowedUsers]);

  const settleAuthFailure = useCallback((message: string, email?: string) => {
    authAccessControllerRef.current?.abort();
    authAccessControllerRef.current = undefined;
    authRunRef.current += 1;
    queuedSessionKeyRef.current = undefined;
    activeSessionUserIdRef.current = undefined;
    authSettledRef.current = true;
    setSessionRevision((revision) => revision + 1);
    setSessionUserId(undefined);
    setProductionUser(email ? { ...signedOutUser, email, displayName: email } : signedOutUser);
    setMfaRequired(false);
    setMfaFactorId(undefined);
    setExplicitAuthError(message);
    setAuthReady(true);
  }, []);

  const resolveProductionSession = useCallback(async (incomingSession: Session | null) => {
    if (demoMode) return;

    const explicitlySignedOut = typeof window !== "undefined" && window.localStorage.getItem(EXPLICIT_SIGN_OUT_KEY) === "true";
    const session = explicitlySignedOut ? null : incomingSession;
    if (explicitlySignedOut && incomingSession) clearSupabaseBrowserSessionStorage();

    const runId = ++authRunRef.current;
    authAccessControllerRef.current?.abort();
    setSessionRevision((revision) => revision + 1);
    const email = session?.user.email?.trim();
    queuedSessionKeyRef.current = sessionKey(session);
    activeSessionUserIdRef.current = session?.user.id;
    authSettledRef.current = false;
    setAuthReady(false);
    setExplicitAuthError(undefined);
    setMfaRequired(false);
    setMfaFactorId(undefined);

    if (!session) {
      setSessionUserId(undefined);
      setProductionUser(signedOutUser);
      authSettledRef.current = true;
      setAuthReady(true);
      return;
    }

    setSessionUserId(session.user.id);
    setProductionUser(email ? { ...signedOutUser, email, displayName: email } : signedOutUser);

    if (!supabase) {
      settleAuthFailure("Supabase Auth is not configured.", email);
      return;
    }

    if (!email) {
      settleAuthFailure("The signed-in Google account does not provide an email address.");
      return;
    }

    const accessCheckController = new AbortController();
    authAccessControllerRef.current = accessCheckController;

    try {
      const allowedUser = await withTimeout(
        findAllowedUser(supabase, email, accessCheckController),
        AUTH_RESOLUTION_TIMEOUT_MS,
        "Account access check",
        () => accessCheckController.abort()
      );
      if (runId !== authRunRef.current) return;

      if (!allowedUser) {
        setProductionUser({ ...signedOutUser, email, displayName: email });
        setExplicitAuthError(`${email} is not on the Fast Track allowlist. Ask an owner to add or reactivate this account.`);
        authSettledRef.current = true;
        setAuthReady(true);
        return;
      }

      if (ownerMfaRequired && allowedUser.role === "owner") {
        const { data: aalData, error: aalError } = await withTimeout(
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
          AUTH_OPERATION_TIMEOUT_MS,
          "MFA assurance check"
        );
        if (runId !== authRunRef.current) return;
        if (aalError) throw aalError;

        if (aalData.currentLevel !== "aal2") {
          const { data: factorData, error: factorError } = await withTimeout(
            supabase.auth.mfa.listFactors(),
            AUTH_OPERATION_TIMEOUT_MS,
            "MFA factor check"
          );
          if (runId !== authRunRef.current) return;
          if (factorError) throw factorError;

          const factor = factorData.totp.find((candidate) => candidate.status === "verified")
            ?? factorData.all.find((candidate) => candidate.factor_type === "totp" && candidate.status === "verified");

          setProductionUser(allowedUser);
          setMfaFactorId(factor?.id);
          setMfaRequired(true);
          setExplicitAuthError(factor ? undefined : "Owner access requires an enrolled authenticator factor.");
          authSettledRef.current = true;
          setAuthReady(true);
          return;
        }
      }

      setProductionUser(allowedUser);
      setMfaRequired(false);
      setMfaFactorId(undefined);
      setExplicitAuthError(undefined);
      authSettledRef.current = true;
      setAuthReady(true);
    } catch (error) {
      if (runId !== authRunRef.current) return;
      settleAuthFailure(authErrorMessage(error), email);
    } finally {
      if (authAccessControllerRef.current === accessCheckController) {
        authAccessControllerRef.current = undefined;
      }
    }
  }, [settleAuthFailure, supabase]);

  useEffect(() => {
    if (demoMode) return;

    if (!supabase) {
      settleAuthFailure("Supabase Auth is not configured.");
      return;
    }

    let receivedInitialState = false;
    const scheduledTasks = new Set<ReturnType<typeof setTimeout>>();
    const initializationTimer = globalThis.setTimeout(() => {
      if (!receivedInitialState) {
        settleAuthFailure("Session checking took too long. Check your connection and try again.");
      }
    }, AUTH_INITIALIZATION_TIMEOUT_MS);

    const scheduleResolution = (event: AuthChangeEvent, session: Session | null) => {
      receivedInitialState = true;
      globalThis.clearTimeout(initializationTimer);

      const nextSessionKey = sessionKey(session);
      const sameQueuedSession = queuedSessionKeyRef.current === nextSessionKey;
      const sameActiveUser = Boolean(session && session.user.id === activeSessionUserIdRef.current);

      if (event === "TOKEN_REFRESHED" && sameActiveUser && authSettledRef.current) {
        queuedSessionKeyRef.current = nextSessionKey;
        return;
      }

      if ((event === "INITIAL_SESSION" || event === "SIGNED_IN") && sameQueuedSession) return;

      authRunRef.current += 1;
      authAccessControllerRef.current?.abort();
      queuedSessionKeyRef.current = nextSessionKey;
      const task = globalThis.setTimeout(() => {
        scheduledTasks.delete(task);
        void resolveProductionSession(session);
      }, 0);
      scheduledTasks.add(task);
    };

    const handleExplicitSignOut = (event: StorageEvent) => {
      if (event.key !== EXPLICIT_SIGN_OUT_KEY || event.newValue !== "true") return;
      clearSupabaseBrowserSessionStorage();
      scheduleResolution("SIGNED_OUT", null);
    };

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(scheduleResolution);
    window.addEventListener("storage", handleExplicitSignOut);

    return () => {
      authRunRef.current += 1;
      authAccessControllerRef.current?.abort();
      authAccessControllerRef.current = undefined;
      globalThis.clearTimeout(initializationTimer);
      for (const task of scheduledTasks) globalThis.clearTimeout(task);
      scheduledTasks.clear();
      window.removeEventListener("storage", handleExplicitSignOut);
      subscription.unsubscribe();
    };
  }, [resolveProductionSession, settleAuthFailure, supabase]);

  const retryAuth = useCallback(async () => {
    if (demoMode) return;
    if (!supabase) {
      settleAuthFailure("Supabase Auth is not configured.");
      return;
    }

    setAuthBusy(true);
    setAuthReady(false);
    setExplicitAuthError(undefined);

    try {
      const { data, error } = await withTimeout(
        supabase.auth.getSession(),
        AUTH_OPERATION_TIMEOUT_MS,
        "Session check"
      );
      if (error) throw error;
      await resolveProductionSession(data.session);
    } catch (error) {
      settleAuthFailure(authErrorMessage(error), productionUser.email || undefined);
    } finally {
      setAuthBusy(false);
    }
  }, [productionUser.email, resolveProductionSession, settleAuthFailure, supabase]);

  const signInWithGoogle = useCallback(async () => {
    if (demoMode) {
      router.push("/dashboard");
      return;
    }

    if (!supabase) {
      settleAuthFailure("Supabase Auth is not configured.");
      return;
    }

    if (!googleAuthEnabled) {
      setExplicitAuthError("Google auth is disabled by NEXT_PUBLIC_ENABLE_GOOGLE_AUTH.");
      return;
    }

    setAuthBusy(true);
    setExplicitAuthError(undefined);
    clearSupabaseBrowserSessionStorage();
    window.localStorage.removeItem(EXPLICIT_SIGN_OUT_KEY);
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/dashboard`,
            queryParams: {
              prompt: "select_account"
            }
          }
        }),
        AUTH_OPERATION_TIMEOUT_MS,
        "Google sign-in"
      );
      if (error) throw error;
    } catch (error) {
      setExplicitAuthError(authErrorMessage(error));
      setAuthReady(true);
    } finally {
      setAuthBusy(false);
    }
  }, [router, settleAuthFailure, supabase]);

  const verifyMfa = useCallback(async (code: string) => {
    if (demoMode || !supabase) return;
    if (!mfaFactorId) {
      setExplicitAuthError("No verified authenticator factor is available. Retry access or sign in with another account.");
      return;
    }

    setAuthBusy(true);
    setExplicitAuthError(undefined);
    try {
      const { error } = await withTimeout(
        supabase.auth.mfa.challengeAndVerify({
          factorId: mfaFactorId,
          code
        }),
        AUTH_OPERATION_TIMEOUT_MS,
        "MFA verification"
      );
      if (error) throw error;
    } catch (error) {
      setExplicitAuthError(authErrorMessage(error));
      setAuthReady(true);
    } finally {
      setAuthBusy(false);
    }
  }, [mfaFactorId, supabase]);

  const signOut = useCallback(async () => {
    authAccessControllerRef.current?.abort();
    authAccessControllerRef.current = undefined;
    authRunRef.current += 1;
    queuedSessionKeyRef.current = "signed-out";
    activeSessionUserIdRef.current = undefined;
    authSettledRef.current = true;
    setSessionRevision((revision) => revision + 1);
    setAuthBusy(true);
    setSessionUserId(undefined);
    setProductionUser(signedOutUser);
    setMfaRequired(false);
    setMfaFactorId(undefined);
    setExplicitAuthError(undefined);
    setAuthReady(true);
    router.replace("/");

    if (demoMode) {
      window.localStorage.removeItem(CURRENT_USER_KEY);
      setAuthBusy(false);
      return;
    }

    try {
      window.localStorage.setItem(EXPLICIT_SIGN_OUT_KEY, "true");
    } catch (error) {
      console.warn("Could not persist the signed-out marker on this device.", error);
    }

    try {
      if (supabase) {
        const { error } = await withTimeout(
          supabase.auth.signOut({ scope: "local" }),
          AUTH_OPERATION_TIMEOUT_MS,
          "Sign out"
        );
        if (error) throw error;
      }
    } catch (error) {
      setExplicitAuthError(`Signed out on this device. ${authErrorMessage(error)}`);
    } finally {
      clearSupabaseBrowserSessionStorage();
      setAuthBusy(false);
      router.replace("/");
      router.refresh();
    }
  }, [router, supabase]);

  const currentUser = demoMode
    ? demoAllowedUsers.find((user) => user.id === currentUserId && user.active) ?? owner
    : productionUser;
  const isAuthenticated = demoMode
    ? currentUser.active
    : authReady && currentUser.active && !mfaRequired && !explicitAuthError;

  const value = useMemo<AuthContextValue>(() => {
    function setCurrentUserId(id: string) {
      if (!demoMode) return;
      try {
        window.localStorage.setItem(CURRENT_USER_KEY, id);
      } catch (error) {
        console.warn("Could not persist the selected demo user on this device.", error);
      }
      setCurrentUserIdState(id);
    }

    function signInAsRole(role: Role) {
      if (!demoMode) {
        void signInWithGoogle();
        return;
      }

      const next = demoAllowedUsers.find((user) => user.role === role && user.active);
      if (!next) return;
      setCurrentUserId(next.id);
      router.push("/dashboard");
    }

    return {
      currentUser,
      sessionUserId,
      sessionRevision,
      setCurrentUserId,
      signInAsRole,
      signInWithGoogle,
      verifyMfa,
      retryAuth,
      signOut,
      loginPath: "/",
      isDemoMode: demoMode,
      isAuthenticated,
      authReady,
      authBusy,
      mfaRequired,
      canVerifyMfa: Boolean(mfaFactorId),
      authError: explicitAuthError
    };
  }, [authBusy, authReady, currentUser, demoAllowedUsers, explicitAuthError, isAuthenticated, mfaFactorId, mfaRequired, retryAuth, router, sessionRevision, sessionUserId, signInWithGoogle, signOut, verifyMfa]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function useOptionalAuth() {
  return useContext(AuthContext);
}

async function findAllowedUser(supabase: SupabaseClient, email: string, controller: AbortController): Promise<AllowedUser | undefined> {
  const retryDelays = [1_000, 2_000, 4_000];
  const { signal } = controller;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    throwIfAuthAborted(signal);
    const { data, error } = await withTimeout(
      supabase.from("allowed_users").select("*").eq("active", true).abortSignal(signal).retry(false),
      AUTH_OPERATION_TIMEOUT_MS,
      "Account access check",
      () => controller.abort()
    );

    if (!error) {
      const normalizedEmail = email.toLowerCase();
      const match = (data ?? []).find((row) => String(row.email).toLowerCase() === normalizedEmail);
      return match ? allowedUserFromRow(match) : undefined;
    }

    const isClockSyncError = error.message.toLowerCase().includes("jwt issued at future");
    if (!isClockSyncError || attempt === retryDelays.length) throw error;

    await wait(retryDelays[attempt]);
    throwIfAuthAborted(signal);
    const { error: refreshError } = await withTimeout(
      supabase.auth.refreshSession(),
      AUTH_OPERATION_TIMEOUT_MS,
      "Session refresh"
    );
    throwIfAuthAborted(signal);
    if (refreshError) throw refreshError;
  }

  return undefined;
}

function sessionKey(session: Session | null) {
  return session ? `${session.user.id}:${session.access_token}` : "signed-out";
}

function authErrorMessage(error: unknown) {
  if (error instanceof OperationTimeoutError) {
    return `${error.message} Check your connection and try again.`;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The authentication request took too long. Check your connection and try again.";
  }
  if (error instanceof Error) return error.message;
  return "Authentication could not be completed. Try again.";
}

function throwIfAuthAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("The access check was cancelled.", "AbortError");
}
