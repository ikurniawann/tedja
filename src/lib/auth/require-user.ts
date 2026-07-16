import { redirect } from "next/navigation";
import { UserRole } from "@/types";
import { cache } from "react";
import { createServerPgClient } from "@/lib/pg/create-client";
import { queryOne } from "@/lib/db";

export interface AuthUser {
  id: string;
  full_name: string;
  role: UserRole;
  email: string;
  brand_id: string | null;
  company_name: string | null;
  branch_name: string | null;
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

  const scope = await queryOne<{
    company_name: string | null;
    branch_name: string | null;
  }>(
    `SELECT c.name AS company_name, b.name AS branch_name
     FROM configuration.users u
     LEFT JOIN configuration.companies c ON c.id = u.company_id
     LEFT JOIN configuration.branches b ON b.id = u.branch_id
     WHERE u.id = $1`,
    [user.id]
  );

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
      branch_name,
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
