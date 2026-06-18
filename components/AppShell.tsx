"use client";

import {
  BriefcaseBusiness,
  CircleUserRound,
  FileText,
  Home,
  LogOut,
  Package,
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
  const { currentUser, signOut, isAuthenticated, isDemoMode, authReady, authError } = useAuth();
  const { resetDemoData } = useAppData();
  const isLogin = pathname === "/";
  const loadingAuth = !isDemoMode && !authReady && !isLogin;
  const blockedAuth = !isDemoMode && authReady && !isAuthenticated && !isLogin;

  useEffect(() => {
    if (blockedAuth) {
      router.push("/");
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
            <button className="text-button icon-text-button" type="button" onClick={signOut}>
              <LogOut size={15} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </header>
      ) : null}
      {children}
    </>
  );
}
