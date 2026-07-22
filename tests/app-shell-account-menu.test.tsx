import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({
  pathname: "/dashboard",
  setCurrentUserId: vi.fn(),
  signOut: vi.fn(),
  resetDemoData: vi.fn(),
  router: { replace: vi.fn() },
  users: [
    { id: "owner", email: "owner@example.com", role: "owner", displayName: "Jordan Owner", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "tech", email: "tech@example.com", role: "tech", displayName: "Carlos Tech", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "desk", email: "desk@example.com", role: "call_center", displayName: "Priya Desk", active: true, createdAt: "2026-01-01T00:00:00.000Z" }
  ]
}));

vi.mock("next/navigation", () => ({
  usePathname: () => harness.pathname,
  useRouter: () => harness.router
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a>
}));

vi.mock("next/image", () => ({
  default: ({ alt, priority: _priority, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => <img alt={alt ?? ""} {...props} />
}));

vi.mock("@/components/ui/background-paper-shaders", () => ({ BackgroundPaperShaders: () => null }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    currentUser: harness.users[0],
    setCurrentUserId: harness.setCurrentUserId,
    signOut: harness.signOut,
    isAuthenticated: true,
    isDemoMode: true,
    authReady: true,
    authBusy: false,
    authError: undefined
  })
}));

vi.mock("@/lib/data-store", () => ({
  roleLabels: { owner: "Owner", tech: "Tech", call_center: "Call Center" },
  useAppData: () => ({
    allowedUsers: harness.users,
    resetDemoData: harness.resetDemoData,
    loaded: true,
    loadError: undefined,
    retryLoad: vi.fn()
  })
}));

import { AppShell } from "@/components/AppShell";

describe("AppShell account menu", () => {
  beforeEach(() => {
    harness.pathname = "/dashboard";
    harness.setCurrentUserId.mockReset();
    harness.signOut.mockReset();
    harness.resetDemoData.mockReset();
  });

  it("closes after a role change and returns focus to the menu trigger", () => {
    render(<AppShell><main>Dashboard</main></AppShell>);
    const trigger = screen.getByLabelText("Open account menu");
    const menu = trigger.closest("details") as HTMLDetailsElement;

    fireEvent.click(trigger);
    expect(menu.open).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Tech" }));
    expect(harness.setCurrentUserId).toHaveBeenCalledWith("tech");
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the signed-in identity in one canonical header location", () => {
    render(<AppShell><main><h1>Operations</h1></main></AppShell>);

    expect(screen.getAllByText("Jordan Owner", { exact: true })).toHaveLength(1);
    expect(screen.queryByText("Owner workspace")).toBeNull();
    expect(screen.getByRole("heading", { name: "Operations" })).toBeTruthy();
  });

  it("puts owner scheduling settings in the account menu", () => {
    render(<AppShell><main>Dashboard</main></AppShell>);

    fireEvent.click(screen.getByLabelText("Open account menu"));
    expect(screen.getByRole("link", { name: "Scheduling" })).toHaveProperty("href", "http://localhost:3000/settings/scheduling");
  });

  it("dismisses on Escape, outside input, viewport gestures, and navigation", () => {
    const view = render(<AppShell><main>Dashboard</main></AppShell>);
    const trigger = screen.getByLabelText("Open account menu");
    const menu = trigger.closest("details") as HTMLDetailsElement;

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(menu.open).toBe(false);

    fireEvent.click(trigger);
    screen.getByRole("button", { name: "Reset demo data" }).focus();
    fireEvent.scroll(window);
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.touchMove(document.body);
    expect(menu.open).toBe(false);

    fireEvent.click(trigger);
    harness.pathname = "/jobs";
    view.rerender(<AppShell><main>Jobs</main></AppShell>);
    expect(menu.open).toBe(false);
  });
});
