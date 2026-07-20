import { redirect } from "next/navigation";
import { UserRole } from "@/types";
import { cache } from "react";
import { createServerPgClient } from "@/lib/pg/create-client";
import { queryOne } from "@/lib/db";
import { loadUserWarehouses } from "@/lib/users/user-warehouses";
import { resolveActiveStallFromCookies } from "@/lib/auth/active-stall";
import { getStallAccess } from "@/lib/auth/stall-access";

export interface AuthUser {
  id: string;
  full_name: string;
  role: UserRole;
  email: string;
  brand_id: string | null;
  company_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  warehouse_name: string | null;
  /**
   * Stall aktif pilihan super_admin/admin (switcher sidebar).
   * null = Semua Stall; bila cookie belum pernah diset, fallback ke penempatan user.
   */
  active_stall_id: string | null;
}

export const getUser = cache(async (): Promise<{
  user: AuthUser | null;
  db: Awaited<ReturnType<typeof createServerPgClient>>;
}> => {
  const db = await createServerPgClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) return { user: null, db };

  const { data: profile } = await db
    .from("users")
    .select("full_name, role, brand_id, business_scope")
    .eq("id", user.id)
    .single();

  if (!profile) return { user: null, db };

  const canSwitchStall = profile.role === "super_admin" || profile.role === "admin";

  const [scope, warehouses, resolvedStall] = await Promise.all([
    queryOne<{
      company_name: string | null;
      branch_id: string | null;
      branch_name: string | null;
    }>(
      `SELECT c.name AS company_name, u.branch_id, b.name AS branch_name
       FROM configuration.users u
       LEFT JOIN configuration.companies c ON c.id = u.company_id
       LEFT JOIN configuration.branches b ON b.id = u.branch_id
       WHERE u.id = $1`,
      [user.id]
    ),
    loadUserWarehouses(user.id),
    canSwitchStall ? resolveActiveStallFromCookies() : Promise.resolve({ mode: "unset" as const }),
  ]);

  // Default penempatan: Main Storage (is_default) jika ada, else stall pertama.
  const placementDefault = warehouses[0] ?? null;

  let warehouse_name: string | null;
  let active_stall_id: string | null;

  if (canSwitchStall) {
    const access = await getStallAccess(
      user.id,
      profile.role,
      scope?.branch_id ?? null
    );
    const allowedIds = new Set(access.stalls.map((stall) => stall.id));
    // Stall default dari penempatan; bila allAccess tanpa penempatan → Semua Stall.
    const fallbackName = placementDefault?.name ?? (access.allAccess ? "Semua Stall" : null);
    const fallbackId = placementDefault?.warehouse_id ?? null;

    if (resolvedStall.mode === "stall" && allowedIds.has(resolvedStall.stall.id)) {
      // Cookie valid & masih dalam penempatan / akses user.
      warehouse_name = resolvedStall.stall.name;
      active_stall_id = resolvedStall.stall.id;
    } else if (resolvedStall.mode === "all" && access.allAccess) {
      // "Semua Stall" hanya bila user memang punya akses bebas.
      warehouse_name = "Semua Stall";
      active_stall_id = null;
    } else {
      // Cookie kosong / tidak valid / di luar penempatan → ikut tempat user.
      warehouse_name = fallbackName;
      active_stall_id = fallbackId;
    }
  } else {
    warehouse_name =
      warehouses.length > 0 ? warehouses.map((warehouse) => warehouse.name).join(", ") : null;
    active_stall_id = null;
  }

  const isUnscoped =
    profile.role === "super_admin" || !profile.business_scope;

  const companyFromDb = scope?.company_name?.trim() || null;
  const branchFromDb = scope?.branch_name?.trim() || null;

  let company_name: string | null;
  let branch_name: string | null;

  if (isUnscoped) {
    company_name = companyFromDb ?? "Semua";
    branch_name = branchFromDb;
  } else {
    company_name = companyFromDb;
    branch_name = branchFromDb;
  }

  return {
    user: {
      id: user.id,
      full_name: profile.full_name,
      role: profile.role as UserRole,
      email: user.email ?? "",
      brand_id: profile.brand_id,
      company_name,
      branch_id: scope?.branch_id ?? null,
      branch_name,
      warehouse_name,
      active_stall_id,
    },
    db,
  };
});

export const requireUser = cache(async (): Promise<AuthUser> => {
  const { user } = await getUser();
  // Lewat /api/auth/logout (GET) agar cookie session yang tidak valid ikut
  // terhapus — redirect langsung ke /login membuat middleware memantulkan
  // balik ke /dashboard selama cookie masih ada (redirect loop).
  if (!user) redirect("/api/auth/logout");
  return user;
});

export async function requireRole(roles: UserRole[]): Promise<AuthUser> {
  const user = await requireUser();
  if (user.role !== "super_admin" && !roles.includes(user.role)) {
    redirect("/dashboard");
  }
  return user;
}
