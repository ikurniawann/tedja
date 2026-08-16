import { iamDbQuery } from "@/lib/iam/pg-client";

export function hasIamMenuCode(grantedCodes: string[], code: string): boolean {
  return grantedCodes.includes(code);
}

export async function loadGrantedMenuCodes(roleIds: string[]): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const rows = await iamDbQuery<{ code: string }>(
    `SELECT DISTINCT m.code
     FROM iam.role_menu_permissions rmp
     JOIN iam.menus m ON m.id = rmp.menu_id
     WHERE rmp.role_id = ANY($1::uuid[])
       AND rmp.is_active = true
       AND m.deleted_at IS NULL
       AND m.is_active = true`,
    [roleIds]
  );
  return rows.map((row) => row.code);
}
