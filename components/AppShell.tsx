"use client";

import {
  BriefcaseBusiness,
  CircleUserRound,
  FileText,
  Home,
  LogOut,
  Package,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Users
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { BackgroundPaperShaders } from "@/components/ui/background-paper-shaders";
import type { Role } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

type NavItem = { href: string; label: string; roles: Role[]; Icon: LucideIcon };

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Home", roles: ["owner", "tech", "call_center"], Icon: Home },
  { href: "/customers", label: "Customers", roles: ["owner", "tech", "call_center"], Icon: Users },
  { href: "/jobs", label: "Jobs", roles: ["owner", "tech", "call_center"], Icon: BriefcaseBusiness },
  { href: "/parts", label: "Parts", roles: ["owner"], Icon: Package },
  { href: "/invoices", label: "Invoices", roles: ["owner", "tech"], Icon: FileText },
  { href: "/admin/users", label: "Users", roles: ["owner"], Icon: ShieldCheck }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, signOut, isAuthenticated, isDemoMode, authReady, authBusy, authError } = useAuth();
  const { resetDemoData, loaded: workspaceLoaded, loadError, retryLoad } = useAppData();
  const isLogin = pathname === "/";
  const loadingAuth = !isDemoMode && !authReady && !isLogin;
  const blockedAuth = !isDemoMode && authReady && !isAuthenticated && !isLogin;
  const loadingWorkspace = !isDemoMode && isAuthenticated && !workspaceLoaded && !loadError && !isLogin;
  const failedWorkspace = !isDemoMode && isAuthenticated && Boolean(loadError) && !isLogin;

  useEffect(() => {
    if (blockedAuth) {
      router.replace("/");
    }
  }, [blockedAuth, router]);

  if (loadingAuth || blockedAuth) {
    return (
      <main className="auth-screen">
        <BackgroundPaperShaders />
        <section className="auth-card auth-status-card">
          <div className="auth-mark" aria-hidden="true">
            <CircleUserRound size={22} />
          </div>
          <h1>{loadingAuth ? "Checking access" : "Access required"}</h1>
          <p className={authError ? "error-message" : "muted"}>{authError ?? "Redirecting to sign in."}</p>
        </section>
      </main>
    );
  }

  if (loadingWorkspace || failedWorkspace) {
    return (
      <main className="auth-screen">
        <BackgroundPaperShaders />
        <section className="auth-card auth-status-card">
          <div className="auth-mark" aria-hidden="true">
            {failedWorkspace ? <RefreshCw size={22} /> : <CircleUserRound size={22} />}
          </div>
          <h1>{failedWorkspace ? "Workspace unavailable" : "Loading workspace"}</h1>
          <p className={failedWorkspace ? "error-message" : "muted"}>
            {loadError ?? "Your session is ready. Loading the latest customer and job data."}
          </p>
          {failedWorkspace ? (
            <div className="auth-form">
              <button className="button" type="button" onClick={retryLoad}>
                Retry workspace
              </button>
              <button className="auth-secondary-link" type="button" onClick={() => void signOut()} disabled={authBusy}>
                {authBusy ? "Signing out..." : "Sign out"}
              </button>
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <>
      {!isLogin ? (
        <header className="app-header">
          <nav className="main-nav">
            {navItems
              .filter((item) => item.roles.includes(currentUser.role))
              .map((item) => (
                <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? "active" : ""}>
                  <item.Icon size={15} aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              ))}
          </nav>
          <div className="header-actions">
            <div className="profile-chip" title={currentUser.email || currentUser.displayName}>
              <CircleUserRound size={17} aria-hidden="true" />
              <span>
                <strong>{currentUser.displayName || currentUser.email}</strong>
              </span>
            </div>
            {isDemoMode ? <RoleSwitcher /> : null}
            {isDemoMode ? (
              <button className="text-button icon-text-button" type="button" onClick={resetDemoData}>
                <RotateCcw size={15} aria-hidden="true" />
                <span>Reset</span>
              </button>
            ) : null}
            <button className="text-button icon-text-button" type="button" onClick={() => void signOut()} disabled={authBusy}>
              <LogOut size={15} aria-hidden="true" />
              <span>{authBusy ? "Signing out..." : "Sign out"}</span>
            </button>
          </div>
        </header>
      ) : null}
      {children}
    </>
  );
}
