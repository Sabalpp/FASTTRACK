"use client";

import {
  Building2,
  CalendarDays,
  ChevronDown,
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
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { roleLabels, useAppData } from "@/lib/data-store";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { BackgroundPaperShaders } from "@/components/ui/background-paper-shaders";
import { branding } from "@/lib/branding";
import type { Role } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

type NavItem = { href: string; label: string; roles: Role[]; Icon: LucideIcon; exact?: boolean };

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Home", roles: ["owner", "tech", "call_center"], Icon: Home, exact: true },
  { href: "/jobs", label: "Schedule", roles: ["owner", "tech", "call_center"], Icon: CalendarDays },
  { href: "/customers", label: "Customers", roles: ["owner", "tech", "call_center"], Icon: Users },
  { href: "/invoices", label: "Invoices", roles: ["owner", "tech"], Icon: FileText },
];

const secondaryNavItems: NavItem[] = [
  { href: "/parts", label: "Parts catalog", roles: ["owner"], Icon: Package },
  { href: "/admin/users", label: "Team access", roles: ["owner"], Icon: ShieldCheck }
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
  const isRestrictedCustomerIntake = currentUser.role === "tech" && pathname === "/customers/new";
  const accountMenuRef = useRef<HTMLDetailsElement>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const closeAccountMenu = useCallback((restoreFocus = false) => {
    const menu = accountMenuRef.current;
    if (!menu) return;

    const focusWasInside = menu.contains(document.activeElement);
    menu.open = false;
    setAccountMenuOpen(false);

    if (restoreFocus || focusWasInside) {
      menu.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    if (blockedAuth) {
      router.replace("/");
    }
  }, [blockedAuth, router]);

  useEffect(() => {
    closeAccountMenu();
  }, [closeAccountMenu, pathname]);

  useEffect(() => {
    const closeAfterViewportGesture = () => {
      if (!accountMenuRef.current?.open) return;
      const focusIsInside = Boolean(accountMenuRef.current?.contains(document.activeElement));
      closeAccountMenu(focusIsInside);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (accountMenuRef.current?.open && !accountMenuRef.current.contains(event.target as Node)) closeAccountMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !accountMenuRef.current?.open) return;
      event.preventDefault();
      closeAccountMenu(true);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("touchmove", closeAfterViewportGesture, { passive: true });
    window.addEventListener("scroll", closeAfterViewportGesture, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("touchmove", closeAfterViewportGesture);
      window.removeEventListener("scroll", closeAfterViewportGesture, true);
    };
  }, [closeAccountMenu]);

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

  const roleLabel = currentUser.role === "call_center" ? "Call center" : roleLabels[currentUser.role];

  return (
    <div className={isLogin ? "ft5-auth" : isRestrictedCustomerIntake ? "ft5-app ft5-customer-intake" : "ft5-app"}>
      {!isLogin && !isRestrictedCustomerIntake ? (
        <header className="app-header ft5-header">
          <Link className="ft5-brand" href="/dashboard" aria-label={`${branding.businessName} home`} onClick={() => closeAccountMenu()}>
            <span className="ft5-brand-mark" aria-hidden="true">
              <Image src={branding.logoPath} alt="" width={44} height={34} priority />
            </span>
            <span className="ft5-brand-copy">
              <strong>Fast Track</strong>
              <small>{isDemoMode ? "Demo workspace" : "Field service"}</small>
            </span>
          </Link>
          <nav className="main-nav ft5-main-nav" aria-label="Primary navigation">
            {navItems
              .filter((item) => item.roles.includes(currentUser.role))
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={(item.exact ? pathname === item.href : pathname.startsWith(item.href)) ? "active" : ""}
                  aria-current={(item.exact ? pathname === item.href : pathname.startsWith(item.href)) ? "page" : undefined}
                  onClick={() => closeAccountMenu()}
                >
                  <item.Icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              ))}
          </nav>
          <div className="header-actions ft5-header-actions">
            <details
              className="ft5-account-menu"
              ref={accountMenuRef}
              onToggle={() => setAccountMenuOpen(Boolean(accountMenuRef.current?.open))}
            >
              <summary aria-label="Open account menu" aria-expanded={accountMenuOpen}>
                <span className="ft5-avatar" aria-hidden="true">
                  {(currentUser.displayName || currentUser.email || "FT").slice(0, 1).toUpperCase()}
                </span>
                <span className="ft5-account-copy">
                  <strong>{currentUser.displayName || currentUser.email}</strong>
                  <small>{roleLabel}</small>
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <div className="ft5-account-popover">
                <div className="ft5-account-context">
                  <Building2 size={17} aria-hidden="true" />
                  <span><strong>{branding.businessName}</strong><small>{currentUser.email}</small></span>
                </div>
                {isDemoMode ? (
                  <div className="ft5-demo-role">
                    <span>Preview role</span>
                    <RoleSwitcher onRoleChange={() => closeAccountMenu(true)} />
                  </div>
                ) : null}
                {secondaryNavItems
                  .filter((item) => item.roles.includes(currentUser.role))
                  .map((item) => (
                    <Link key={item.href} href={item.href} onClick={() => closeAccountMenu()}>
                      <item.Icon size={17} aria-hidden="true" />
                      <span>{item.label}</span>
                    </Link>
                  ))}
                {isDemoMode ? (
                  <button type="button" onClick={() => { closeAccountMenu(); resetDemoData(); }}>
                    <RotateCcw size={17} aria-hidden="true" />
                    <span>Reset demo data</span>
                  </button>
                ) : null}
                <button type="button" onClick={() => { closeAccountMenu(); void signOut(); }} disabled={authBusy}>
                  <LogOut size={17} aria-hidden="true" />
                  <span>{authBusy ? "Signing out…" : "Sign out"}</span>
                </button>
              </div>
            </details>
          </div>
        </header>
      ) : null}
      {children}
    </div>
  );
}
