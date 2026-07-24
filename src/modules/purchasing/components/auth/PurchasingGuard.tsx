"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";

/** Props for PurchasingGuard */
interface PurchasingGuardProps {
  /** Minimum role required to access the route */
  minRole?: "purchasing_staff" | "purchasing_manager" | "purchasing_admin" | "super_admin";
  /** Explicit list of allowed roles */
  allowedRoles?: string[];
  /** Content to render when access is granted */
  children: React.ReactNode;
  /** Redirect destination when denied (default: /dashboard) */
  fallbackHref?: string;
}

/**
 * Role-based access guard for purchasing module pages.
 * Redirects to fallbackHref when user lacks permission.
 */
export default function PurchasingGuard({
  minRole,
  allowedRoles,
  children,
  fallbackHref = "/dashboard",
}: PurchasingGuardProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const role = user?.role;
    if (!role) {
      router.replace(fallbackHref);
      return;
    }

    let denied = true;

    // Platform admin can access all purchasing screens.
    if (role === "admin" || role === "super_admin") {
      denied = false;
    } else if (allowedRoles && allowedRoles.length > 0) {
      denied = !allowedRoles.includes(role);
    } else if (minRole) {
      // ROLE_HIERARCHY: [viewer, warehouse_staff, qc_staff, purchasing_staff, purchasing_manager, purchasing_admin, super_admin]
      const hierarchy = [
        "viewer",
        "warehouse_staff",
        "qc_staff",
        "purchasing_staff",
        "purchasing_manager",
        "purchasing_admin",
        "super_admin",
      ] as const;
      const userIdx = hierarchy.indexOf(role as any);
      const minIdx = hierarchy.indexOf(minRole as any);
      denied = userIdx < minIdx;
    }

    if (denied) {
      router.replace(fallbackHref);
    }
  }, [user, loading, minRole, allowedRoles, fallbackHref, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm">Memeriksa akses...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Hook version — returns { allowed: boolean, loading: boolean }
 * for use inside page components that already handle their own redirect.
 */
export function usePurchasingAccess(
  minRole?: PurchasingGuardProps["minRole"],
  allowedRoles?: string[]
) {
  const { user, loading } = useAuth();

  if (loading || !user) {
    return { allowed: false, loading: true };
  }

  const role = user.role;

  if (role === "admin" || role === "super_admin") {
    return { allowed: true, loading: false };
  }

  if (allowedRoles && allowedRoles.length > 0) {
    return { allowed: allowedRoles.includes(role), loading: false };
  }

  if (minRole) {
    const hierarchy = [
      "viewer",
      "warehouse_staff",
      "qc_staff",
      "purchasing_staff",
      "purchasing_manager",
      "purchasing_admin",
      "super_admin",
    ] as const;
    const userIdx = hierarchy.indexOf(role as any);
    const minIdx = hierarchy.indexOf(minRole as any);
    return { allowed: userIdx >= minIdx, loading: false };
  }

  return { allowed: true, loading: false };
}
