"use client";

import { useAuth } from "@/lib/auth";
import { roleLabels, useAppData } from "@/lib/data-store";
import type { Role } from "@/lib/types";

const roleOrder: Role[] = ["owner", "tech", "call_center"];

export function RoleSwitcher({
  onRoleChange
}: {
  onRoleChange?: (role: Role, userId: string) => void;
} = {}) {
  const { currentUser, setCurrentUserId, isDemoMode } = useAuth();
  const { allowedUsers } = useAppData();

  if (!isDemoMode) return null;

  return (
    <div className="role-switcher" aria-label="Demo role">
      <div className="role-switcher-tabs">
        {roleOrder.map((role) => {
          const user = allowedUsers.find((candidate) => candidate.active && candidate.role === role);
          if (!user) return null;
          return (
          <button
            key={user.id}
            type="button"
            className={user.id === currentUser.id ? "active" : ""}
            title={role === "call_center" ? "Desk" : roleLabels[role]}
            onClick={() => {
              setCurrentUserId(user.id);
              onRoleChange?.(role, user.id);
            }}
          >
            <strong>{role === "call_center" ? "Desk" : roleLabels[role]}</strong>
          </button>
          );
        })}
      </div>
    </div>
  );
}
