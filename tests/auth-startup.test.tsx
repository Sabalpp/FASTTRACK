import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

const testHarness = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof createMockClient>,
  authCallback: undefined as ((event: AuthChangeEvent, session: Session | null) => void) | undefined,
  pathname: "/",
  router: {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn()
  },
  clearSessionStorage: vi.fn()
}));

vi.mock("@/lib/runtime", () => ({
  demoMode: false,
  googleAuthEnabled: true,
  ownerMfaRequired: false
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseBrowserClient: () => testHarness.client,
  clearSupabaseBrowserSessionStorage: testHarness.clearSessionStorage
}));

vi.mock("next/navigation", () => ({
  usePathname: () => testHarness.pathname,
  useRouter: () => testHarness.router
}));

vi.mock("@/components/ui/background-paper-shaders", () => ({
  BackgroundPaperShaders: () => null
}));

import LoginPage from "@/app/page";
import { AppProviders } from "@/components/AppProviders";
import { AppShell } from "@/components/AppShell";
import { AuthProvider, useAuth } from "@/lib/auth";

type QueryResult = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

type QueryMode = "access" | "workspace" | "unknown";
type QueryResolver = (table: string, mode: QueryMode) => QueryResult | Promise<QueryResult>;

const allowedUserRow = {
  id: "user-1",
  email: "owner@example.com",
  role: "owner",
  display_name: "Owner",
  active: true,
  created_at: "2026-01-01T00:00:00.000Z"
};

const validSession = {
  access_token: "access-token",
  refresh_token: "refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 2_000_000_000,
  user: {
    id: "auth-user-1",
    email: "owner@example.com"
  }
} as Session;

describe("production auth startup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testHarness.pathname = "/";
    testHarness.authCallback = undefined;
    testHarness.router.push.mockReset();
    testHarness.router.replace.mockReset();
    testHarness.router.refresh.mockReset();
    testHarness.clearSessionStorage.mockReset();
    testHarness.client = createMockClient(defaultQueryResolver);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enables Google sign-in without loading workspace data when the initial session is signed out", async () => {
    render(
      <AppProviders>
        <LoginPage />
      </AppProviders>
    );

    await emitAuthEvent("INITIAL_SESSION", null);

    const button = screen.getByRole("button", { name: "Continue with Google" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(testHarness.client.from).not.toHaveBeenCalled();
  });

  it("settles into a recoverable error when no initial auth event arrives", async () => {
    render(
      <AppProviders>
        <LoginPage />
      </AppProviders>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(18_000);
    });

    expect(screen.getByText("Session checking took too long. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry access" })).toBeTruthy();
    expect(screen.queryByText("Checking session...")).toBeNull();
  });

  it("times out a stalled workspace independently and allows a successful retry", async () => {
    let stallCustomers = true;
    testHarness.pathname = "/dashboard";
    testHarness.client = createMockClient((table, mode) => {
      if (mode === "access") return { data: [allowedUserRow], error: null };
      if (table === "customers" && stallCustomers) return new Promise<QueryResult>(() => undefined);
      return defaultQueryResolver(table, mode);
    });

    render(
      <AppProviders>
        <AppShell>
          <div>Dashboard content</div>
        </AppShell>
      </AppProviders>
    );

    await emitAuthEvent("INITIAL_SESSION", validSession);
    await flushMicrotasks();
    expect(screen.getByText("Loading workspace")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await flushMicrotasks();

    expect(screen.getByText("Workspace unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry workspace" })).toBeTruthy();

    stallCustomers = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry workspace" }));
    await flushMicrotasks();

    expect(screen.getByText("Dashboard content")).toBeTruthy();
  });

  it("refreshes a future-dated JWT before retrying the allowlist check", async () => {
    let accessChecks = 0;
    testHarness.client = createMockClient((_table, mode) => {
      if (mode === "access") {
        accessChecks += 1;
        if (accessChecks === 1) return { data: null, error: { message: "JWT issued at future" } };
        return { data: [allowedUserRow], error: null };
      }
      return { data: [], error: null };
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await emitAuthEvent("INITIAL_SESSION", validSession);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();

    expect(testHarness.client.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(accessChecks).toBe(2);
    expect(screen.getByText("authenticated")).toBeTruthy();
  });

  it("keeps an explicit sign-out across a remount even when remote sign-out stalls", async () => {
    testHarness.client.auth.signOut.mockImplementation(() => new Promise(() => undefined));
    const firstRender = render(
      <AuthProvider>
        <AuthControls />
      </AuthProvider>
    );

    await emitAuthEvent("INITIAL_SESSION", validSession);
    expect(screen.getByText("authenticated")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(window.localStorage.getItem("hvac-plumbing-mvp-explicit-sign-out")).toBe("true");
    expect(screen.getByText("signed-out")).toBeTruthy();

    firstRender.unmount();
    testHarness.authCallback = undefined;
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );
    await emitAuthEvent("INITIAL_SESSION", validSession);

    expect(screen.getByText("signed-out")).toBeTruthy();
    expect(screen.queryByText("authenticated")).toBeNull();
  });
});

function AuthProbe() {
  const { authReady, isAuthenticated, authError } = useAuth();
  if (!authReady) return <div>checking</div>;
  if (authError) return <div>{authError}</div>;
  return <div>{isAuthenticated ? "authenticated" : "signed-out"}</div>;
}

function AuthControls() {
  const { authReady, isAuthenticated, signOut } = useAuth();
  return (
    <div>
      <span>{authReady && isAuthenticated ? "authenticated" : "signed-out"}</span>
      <button type="button" onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}

function defaultQueryResolver(table: string, mode: QueryMode): QueryResult {
  if (mode === "access") return { data: [allowedUserRow], error: null };
  if (table === "allowed_users") return { data: [allowedUserRow], error: null };
  return { data: [], error: null };
}

function createMockClient(resolveQuery: QueryResolver) {
  const auth = {
    onAuthStateChange: vi.fn((callback: (event: AuthChangeEvent, session: Session | null) => void) => {
      testHarness.authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    refreshSession: vi.fn(async () => ({ data: { session: validSession, user: validSession.user }, error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: { provider: "google", url: "https://example.com" }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(async () => ({
        data: { currentLevel: "aal1", nextLevel: "aal1", currentAuthenticationMethods: [] },
        error: null
      })),
      listFactors: vi.fn(async () => ({ data: { all: [], totp: [], phone: [] }, error: null })),
      challengeAndVerify: vi.fn(async () => ({ data: null, error: null }))
    }
  };

  const client = {
    auth,
    from: vi.fn((table: string) => ({
      select: vi.fn(() => createQueryBuilder(table, resolveQuery))
    })),
    rpc: vi.fn(async () => ({ data: [], error: null })),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: null, error: null }))
      }))
    }
  };

  return client;
}

function createQueryBuilder(table: string, resolveQuery: QueryResolver) {
  let mode: QueryMode = "unknown";
  let signal: AbortSignal | undefined;

  const builder = {
    eq: vi.fn(() => {
      mode = "access";
      return builder;
    }),
    order: vi.fn(() => {
      mode = "workspace";
      return builder;
    }),
    limit: vi.fn(() => builder),
    abortSignal: vi.fn((nextSignal: AbortSignal) => {
      signal = nextSignal;
      return builder;
    }),
    retry: vi.fn(() => builder),
    then: <TResult1 = QueryResult, TResult2 = never>(
      onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) => abortableQuery(resolveQuery(table, mode), signal).then(onFulfilled, onRejected)
  };

  return builder;
}

function abortableQuery(result: QueryResult | Promise<QueryResult>, signal?: AbortSignal) {
  if (!signal) return Promise.resolve(result);

  return new Promise<QueryResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(result).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function emitAuthEvent(event: AuthChangeEvent, session: Session | null) {
  expect(testHarness.authCallback).toBeTypeOf("function");
  await act(async () => {
    testHarness.authCallback?.(event, session);
    await vi.advanceTimersByTimeAsync(0);
  });
  await flushMicrotasks();
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
