"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
} from "lucide-react";
import { ArrowsPointingInIcon, ArrowsPointingOutIcon } from "@heroicons/react/24/outline";
import { cn } from "@/lib/utils";
import { AppSidebarNavIcon } from "@/components/shared/app-sidebar-nav-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelToolbar,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TableRow } from "@/components/ui/table";
import type { NavIconName } from "@/lib/iam/types";
import type { MenuItem } from "@/features/configuration/menus/types";
import {
  buildMenuTree,
  collectExpandableIds,
  flattenMenuTree,
  mergeExpandableIds,
  type FlatMenuTreeRow,
} from "@/features/configuration/menus/utils/menu-tree";
import { useRolePermissions } from "../queries";
import type { RoleItem, RoleMenuPermission, RolePermissionUpdate } from "../types";

const MODULE_ICON: Record<string, NavIconName> = {
  dashboard: "home",
  hris: "users",
  purchasing: "shopping",
  items: "cube",
  inventory: "database",
  finance: "money",
  accounting: "reports",
  pos: "shopping",
  crm: "star",
  business: "building",
  "user-management": "users",
};

function buildChildrenByParent(permissions: RoleMenuPermission[]) {
  const byParent = new Map<string, RoleMenuPermission[]>();

  for (const permission of permissions) {
    if (!permission.parentId) continue;
    const list = byParent.get(permission.parentId) ?? [];
    list.push(permission);
    byParent.set(permission.parentId, list);
  }

  return byParent;
}

function collectDescendantMenuIds(
  menuId: string,
  byParent: Map<string, RoleMenuPermission[]>
): string[] {
  const ids: string[] = [];
  const queue = [menuId];

  while (queue.length > 0) {
    const current = queue.pop()!;
    const children = byParent.get(current) ?? [];

    for (const child of children) {
      ids.push(child.menuId);
      queue.push(child.menuId);
    }
  }

  return ids;
}

function applyGrantState(
  permission: RoleMenuPermission,
  granted: boolean
): RoleMenuPermission {
  return {
    ...permission,
    isGranted: granted,
    grantedActions: granted
      ? permission.grantedActions.length > 0
        ? permission.grantedActions
        : permission.availableActions.length > 0
          ? [permission.availableActions[0]]
          : ["read"]
      : [],
  };
}

function permissionToMenuItem(permission: RoleMenuPermission): MenuItem {
  return {
    id: permission.menuId,
    parentId: permission.parentId,
    code: permission.menuCode,
    menuName: permission.menuName,
    routePath: null,
    module: null,
    menuType: permission.menuType,
    icon: null,
    orderNumber: permission.orderNumber,
    level: permission.level,
    isActive: true,
    isVisible: true,
  };
}

function iconForPermission(permission: RoleMenuPermission, isGroup: boolean): NavIconName {
  const root = permission.menuCode.split(".")[0];
  if (permission.level <= 1 && MODULE_ICON[root]) {
    return MODULE_ICON[root];
  }
  return isGroup ? "sitemap" : "clipboard";
}

function getGrantChecked(
  menuId: string,
  draft: Map<string, RoleMenuPermission>,
  byParent: Map<string, RoleMenuPermission[]>
): boolean {
  const permission = draft.get(menuId);
  if (!permission) return false;
  if (permission.isGranted) return true;

  const children = byParent.get(menuId) ?? [];
  if (children.length === 0) return false;

  return children.every((child) => getGrantChecked(child.menuId, draft, byParent));
}

interface PermissionRowProps {
  row: FlatMenuTreeRow;
  permission: RoleMenuPermission;
  expandedIds: Set<string>;
  checkState: boolean;
  onToggleExpand: (id: string) => void;
  onToggleGrant: (menuId: string, granted: boolean) => void;
  onToggleAction: (menuId: string, action: string) => void;
}

function PermissionRow({
  row,
  permission,
  expandedIds,
  checkState,
  onToggleExpand,
  onToggleGrant,
  onToggleAction,
}: PermissionRowProps) {
  const { item, depth, hasChildren } = row;
  const isExpanded = expandedIds.has(item.id);
  const isGroup = item.menuType === "group" || hasChildren;
  const isTopLevel = depth === 0;
  const availableActions =
    permission.availableActions.length > 0 ? permission.availableActions : ["read"];
  const grantedActions =
    permission.grantedActions.length > 0 ? permission.grantedActions : ["read"];
  const iconName = iconForPermission(permission, isGroup);
  const indent = depth * 20;

  return (
    <TableRow
      className={cn(
        "border-b border-gray-200/50 transition-colors hover:bg-gray-50/80",
        isTopLevel && "bg-gray-50/60 hover:bg-gray-50",
        permission.isGranted && !isTopLevel && "bg-pink-50/30 hover:bg-pink-50/50",
        permission.isGranted && isTopLevel && "bg-pink-50/40 hover:bg-pink-50/60"
      )}
    >
      <td className="px-4 py-3 align-middle">
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: indent }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggleExpand(item.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-200/70 hover:text-gray-600"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="inline-block h-6 w-6 shrink-0" aria-hidden />
          )}

          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200/70 bg-white text-gray-600",
              permission.isGranted && "border-pink-200/80 bg-pink-50 text-pink-700"
            )}
          >
            <AppSidebarNavIcon name={iconName} className="h-4 w-4" isActive={false} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                id={`grant-${item.id}`}
                checked={checkState}
                onCheckedChange={(checked) => onToggleGrant(item.id, checked === true)}
              />
              <label
                htmlFor={`grant-${item.id}`}
                className={cn(
                  "cursor-pointer truncate text-sm text-gray-900",
                  isGroup || isTopLevel ? "font-semibold" : "font-medium"
                )}
              >
                {item.menuName}
              </label>
              {isGroup ? (
                <Badge className="border-0 bg-gray-100 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                  Group
                </Badge>
              ) : (
                <Badge className="border-0 bg-gray-100 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                  {item.menuType}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate pl-6 font-mono text-[11px] text-gray-400">
              {permission.menuCode}
            </p>
          </div>
        </div>
      </td>

      <td className="px-4 py-3 align-middle">
        {permission.isGranted ? (
          <div className="flex flex-wrap justify-end gap-1.5 sm:justify-start">
            {availableActions.map((action) => {
              const selected = grantedActions.includes(action);
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => onToggleAction(item.id, action)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                    selected
                      ? "border-pink-200 bg-pink-50 text-pink-700"
                      : "border-gray-200/70 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50"
                  )}
                >
                  {action}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
    </TableRow>
  );
}

interface RolePermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: RoleItem | null;
  isSubmitting: boolean;
  onSubmit: (permissions: RolePermissionUpdate[]) => Promise<void>;
}

export function RolePermissionsDialog({
  open,
  onOpenChange,
  role,
  isSubmitting,
  onSubmit,
}: RolePermissionsDialogProps) {
  const roleId = role?.id ?? null;
  const { data, isLoading, isError } = useRolePermissions(open ? roleId : null);

  const [draft, setDraft] = useState<Map<string, RoleMenuPermission>>(new Map());
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setDraft(new Map());
      setSearch("");
      setExpandedIds(new Set());
      return;
    }

    if (data?.permissions) {
      const next = new Map<string, RoleMenuPermission>();
      for (const permission of data.permissions) {
        next.set(permission.menuId, { ...permission });
      }
      setDraft(next);
    }
  }, [open, data?.permissions]);

  const permissions = useMemo(() => Array.from(draft.values()), [draft]);

  const childrenByParent = useMemo(
    () => buildChildrenByParent(permissions),
    [permissions]
  );

  const filteredPermissions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return permissions;
    return permissions.filter(
      (p) =>
        p.menuName.toLowerCase().includes(q) || p.menuCode.toLowerCase().includes(q)
    );
  }, [permissions, search]);

  const menuItems = useMemo(
    () => permissions.map(permissionToMenuItem),
    [permissions]
  );

  const filteredMenuIds = useMemo(
    () => new Set(filteredPermissions.map((p) => p.menuId)),
    [filteredPermissions]
  );

  const visibleItems = useMemo(() => {
    if (!search.trim()) return menuItems;

    const byId = new Map(menuItems.map((item) => [item.id, item]));
    const keepIds = new Set<string>();

    for (const item of menuItems) {
      if (!filteredMenuIds.has(item.id)) continue;
      keepIds.add(item.id);
      let parentId = item.parentId;
      while (parentId) {
        keepIds.add(parentId);
        parentId = byId.get(parentId)?.parentId ?? null;
      }
    }

    return menuItems.filter((item) => keepIds.has(item.id));
  }, [menuItems, filteredMenuIds, search]);

  const menuTree = useMemo(() => buildMenuTree(visibleItems), [visibleItems]);

  const displayRows = useMemo(
    () => flattenMenuTree(menuTree, expandedIds),
    [menuTree, expandedIds]
  );

  const expandableIds = useMemo(() => collectExpandableIds(menuTree), [menuTree]);

  useEffect(() => {
    if (!open) return;
    setExpandedIds((prev) => mergeExpandableIds(prev, expandableIds));
  }, [open, expandableIds]);

  function updatePermission(
    menuId: string,
    updater: (current: RoleMenuPermission) => RoleMenuPermission
  ) {
    setDraft((prev) => {
      const current = prev.get(menuId);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(menuId, updater(current));
      return next;
    });
  }

  function handleToggleGrant(menuId: string, granted: boolean) {
    setDraft((prev) => {
      const next = new Map(prev);
      const allPermissions = Array.from(prev.values());
      const byParent = buildChildrenByParent(allPermissions);
      const idsToUpdate = [menuId, ...collectDescendantMenuIds(menuId, byParent)];

      for (const id of idsToUpdate) {
        const current = next.get(id);
        if (!current) continue;
        next.set(id, applyGrantState(current, granted));
      }

      return next;
    });
  }

  function handleToggleAction(menuId: string, action: string) {
    updatePermission(menuId, (current) => {
      if (!current.isGranted) return current;

      const hasAction = current.grantedActions.includes(action);
      const nextActions = hasAction
        ? current.grantedActions.filter((item) => item !== action)
        : [...current.grantedActions, action];

      return {
        ...current,
        grantedActions: nextActions.length > 0 ? nextActions : ["read"],
      };
    });
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleExpandAll() {
    setExpandedIds(new Set(expandableIds));
  }

  function handleCollapseAll() {
    setExpandedIds(new Set());
  }

  async function handleSave() {
    if (isSubmitting) return;

    const payload: RolePermissionUpdate[] = permissions
      .filter((p) => p.isGranted)
      .map((p) => ({
        menuId: p.menuId,
        isGranted: true,
        grantedActions:
          p.grantedActions.length > 0 ? p.grantedActions : ["read"],
      }));

    await onSubmit(payload);
  }

  const grantedCount = permissions.filter((p) => p.isGranted).length;
  const totalCount = permissions.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="xl" style={{ "--dialog-panel-max-height": "90vh" } as CSSProperties}>
        <DialogPanelHeader>
          <DialogPanelTitle>Manage Permissions</DialogPanelTitle>
          <DialogPanelDescription>
            {role
              ? `${role.name} (${role.code}) — ${grantedCount} dari ${totalCount} menu aktif`
              : "Assign menu access and actions for this role"}
          </DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelToolbar className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Cari nama atau kode menu..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Badge className="border-0 bg-pink-50 px-2.5 py-1 text-pink-700">
              {grantedCount} granted
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleExpandAll}
              disabled={isLoading || expandableIds.length === 0}
            >
              <ArrowsPointingOutIcon className="h-4 w-4" />
              Expand all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleCollapseAll}
              disabled={isLoading || expandedIds.size === 0}
            >
              <ArrowsPointingInIcon className="h-4 w-4" />
              Collapse all
            </Button>
          </div>
        </DialogPanelToolbar>

        <DialogPanelBody className="py-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-gray-300 border-t-pink-500" />
            </div>
          ) : isError ? (
            <p className="py-16 text-center text-sm text-gray-500">
              Gagal memuat permissions
            </p>
          ) : displayRows.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">Menu tidak ditemukan</p>
          ) : (
            <div className="overflow-hidden border-y border-gray-200/70">
              <div className="max-h-[min(58vh,520px)] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm">
                    <TableRow className="border-b border-gray-200/70 hover:bg-gray-50/95">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Menu
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Actions
                      </th>
                    </TableRow>
                  </thead>
                  <tbody>
                    {displayRows.map((row) => {
                      const permission = draft.get(row.item.id);
                      if (!permission) return null;

                      const isGranted = getGrantChecked(
                        row.item.id,
                        draft,
                        childrenByParent
                      );

                      return (
                        <PermissionRow
                          key={row.item.id}
                          row={row}
                          permission={permission}
                          expandedIds={expandedIds}
                          checkState={isGranted}
                          onToggleExpand={toggleExpand}
                          onToggleGrant={handleToggleGrant}
                          onToggleAction={handleToggleAction}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogPanelBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Batal
          </Button>
          <Button
            type="button"
            className="bg-pink-600 text-white hover:bg-pink-700"
            onClick={handleSave}
            disabled={isSubmitting || isLoading}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Simpan Permissions
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
