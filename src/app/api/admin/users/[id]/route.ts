import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { ApiError, validateBody, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { updateAdminUserSchema } from "@/lib/admin/user-management";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = await requireIamMenuPrefix(IAM.settingsUsers);
    const body = await validateBody(request, updateAdminUserSchema);
    const db = createPgClient();

    if (actor.id === id && (body.status === "inactive" || (body.role && body.role !== "super_admin"))) {
      throw ApiError.badRequest("Super admin tidak bisa menonaktifkan atau menurunkan role dirinya sendiri");
    }

    const authUpdates: Record<string, unknown> = {};
    if (body.email) authUpdates.email = body.email;
    if (body.full_name) authUpdates.user_metadata = { full_name: body.full_name };
    if (body.role) authUpdates.app_metadata = { role: body.role };
    if (body.status) authUpdates.ban_duration = body.status === "inactive" ? "876000h" : "none";

    if (Object.keys(authUpdates).length > 0) {
      const { error: authError } = await db.auth.admin.updateUserById(
        id,
        authUpdates as Parameters<typeof db.auth.admin.updateUserById>[1]
      );
      if (authError) throw ApiError.badRequest(authError.message);
    }

    const profileUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.email) profileUpdates.email = body.email;
    if (body.full_name) profileUpdates.full_name = body.full_name;
    if (body.role) profileUpdates.role = body.role;
    if (body.brand_id !== undefined) profileUpdates.brand_id = body.brand_id;
    if (body.status) profileUpdates.status = body.status;

    const { data: profile, error: profileError } = await db
      .from("users")
      .update(profileUpdates)
      .eq("id", id)
      .select("id, full_name, email, role, brand_id, status, created_at, updated_at")
      .single();

    if (profileError) throw profileError;

    if (body.approval_permissions) {
      const { error: deactivateError } = await db
        .from("user_approval_permissions")
        .update({ is_active: false, updated_by: actor.id, updated_at: new Date().toISOString() })
        .eq("user_id", id);

      if (deactivateError) throw deactivateError;

      const activePermissions = body.approval_permissions.filter((permission) => permission.is_active);
      if (activePermissions.length > 0) {
        const { error: insertError } = await db.from("user_approval_permissions").insert(
          activePermissions.map((permission) => ({
            user_id: id,
            module: permission.module,
            workflow: permission.workflow,
            approval_level: permission.approval_level,
            approval_limit: permission.approval_limit ?? null,
            is_active: true,
            created_by: actor.id,
            updated_by: actor.id,
          }))
        );
        if (insertError) throw insertError;
      }
    }

    await db.from("admin_user_audit_logs").insert({
      actor_id: actor.id,
      target_user_id: id,
      action: "update_user",
      details: {
        fields: Object.keys(body),
        role: body.role,
        status: body.status,
      },
    });

    return NextResponse.json({ data: profile, message: "User berhasil diperbarui" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error updating admin user:", error);
    return NextResponse.json({ error: "Gagal memperbarui user" }, { status: 500 });
  }
}
