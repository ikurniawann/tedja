"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { isNavLinkActive } from "@/lib/iam/nav-active";
import { useNavFrom } from "@/lib/iam/use-nav-from";
import type { NavItem } from "@/lib/iam/types";
import { AppSidebarNavIcon } from "./app-sidebar-nav-icons";

interface AppSidebarNavProps {
  navItems: NavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
}

function navItemKey(item: NavItem): string {
  return `${item.href}::${item.label}`;
}

function collectActiveGroupKeys(
  items: NavItem[],
  pathname: string,
  navFrom: string | null,
  ancestors: string[] = []
): string[] {
  const keys: string[] = [];

  for (const item of items) {
    const childHrefs = item.children?.map((child) => child.href) ?? [];
    const selfActive = isNavLinkActive(pathname, item.href, childHrefs, navFrom);
    const childActive = item.children?.some((child) =>
      isNavLinkActive(pathname, child.href, childHrefs, navFrom)
    );
    const itemKey = navItemKey(item);

    if (item.children?.length && (selfActive || childActive)) {
      keys.push(...ancestors, itemKey);
    }

    if (item.children?.length) {
      keys.push(
        ...collectActiveGroupKeys(item.children, pathname, navFrom, [...ancestors, itemKey])
      );
    }
  }

  return keys;
}

function isGroupActive(item: NavItem, pathname: string, navFrom: string | null): boolean {
  if (!item.children?.length) {
    return isNavLinkActive(pathname, item.href, [], navFrom);
  }

  const childHrefs = item.children.map((child) => child.href);
  return (
    pathname === item.href ||
    item.children.some((child) => isNavLinkActive(pathname, child.href, childHrefs, navFrom))
  );
}

export default function AppSidebarNav({
  navItems,
  collapsed = false,
  onNavigate,
  className = "",
}: AppSidebarNavProps) {
  const pathname = usePathname();
  const navFrom = useNavFrom();
  const autoExpanded = useMemo(
    () => [...new Set(collectActiveGroupKeys(navItems, pathname, navFrom))],
    [navItems, pathname, navFrom]
  );
  const [expandedMenus, setExpandedMenus] = useState<string[]>(autoExpanded);

  useEffect(() => {
    setExpandedMenus((prev) => [...new Set([...prev, ...autoExpanded])]);
  }, [autoExpanded]);

  const toggleMenu = (key: string) => {
    setExpandedMenus((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const topLevelItemClass = (itemActive: boolean, extra = "") =>
    [
      "flex w-full items-center rounded-lg text-sm transition-colors",
      collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
      itemActive
        ? "bg-pink-600 font-semibold text-white"
        : "text-gray-900 hover:bg-pink-100",
      extra,
    ]
      .filter(Boolean)
      .join(" ");

  const submenuItemClass = (
    itemActive: boolean,
    hasChildren: boolean,
    extra = ""
  ) => {
    const base = "flex w-full items-center rounded-md py-2 pl-2 pr-2 text-sm transition-colors";

    if (hasChildren) {
      return [
        base,
        "justify-between font-normal text-gray-800",
        itemActive ? "text-gray-900" : "",
        "hover:bg-gray-100/80",
        extra,
      ]
        .filter(Boolean)
        .join(" ");
    }

    return [
      base,
      itemActive
        ? "bg-pink-50 font-normal text-pink-700"
        : "font-normal text-gray-600 hover:bg-gray-100/80 hover:text-gray-900",
      extra,
    ]
      .filter(Boolean)
      .join(" ");
  };

  const renderItem = (item: NavItem, depth = 0, peerHrefs: string[] = []) => {
    const hasChildren = Boolean(item.children?.length);
    const childHrefs = hasChildren ? item.children!.map((child) => child.href) : [];
    const itemActive = hasChildren
      ? isGroupActive(item, pathname, navFrom)
      : isNavLinkActive(pathname, item.href, peerHrefs, navFrom);
    const itemKey = navItemKey(item);
    const isExpanded = expandedMenus.includes(itemKey);
    const showIcon = depth === 0;
    const isSubmenu = depth > 0;

    if (hasChildren) {
      const groupShellClass = isSubmenu
        ? submenuItemClass(itemActive, true)
        : topLevelItemClass(itemActive, collapsed ? "" : "justify-between");

      return (
        <div key={itemKey}>
          <button
            type="button"
            onClick={() => toggleMenu(itemKey)}
            aria-expanded={isExpanded}
            className={groupShellClass}
            title={collapsed ? item.label : undefined}
          >
            {collapsed ? (
              showIcon ? (
                <AppSidebarNavIcon name={item.icon} isActive={itemActive} />
              ) : (
                <span className="truncate text-xs font-normal">{item.label}</span>
              )
            ) : (
              <>
                <span
                  className={`flex min-w-0 flex-1 items-center text-left ${showIcon ? "gap-3" : ""}`}
                >
                  {showIcon && <AppSidebarNavIcon name={item.icon} isActive={itemActive} />}
                  <span>{item.label}</span>
                </span>
                <ChevronDownIcon
                  className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              </>
            )}
          </button>
          {isExpanded && !collapsed && (
            <div className="ml-3 mt-1 space-y-0.5 border-l border-gray-200/70 pl-3">
              {item.children!.map((child) => renderItem(child, depth + 1, childHrefs))}
            </div>
          )}
        </div>
      );
    }

    const leafShellClass = isSubmenu
      ? submenuItemClass(itemActive, false)
      : topLevelItemClass(itemActive);

    return (
      <Link
        key={itemKey}
        href={item.href}
        onClick={onNavigate}
        className={leafShellClass}
        title={collapsed ? item.label : undefined}
      >
        {showIcon && <AppSidebarNavIcon name={item.icon} isActive={itemActive} />}
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  };

  const topLevelHrefs = navItems.map((item) => item.href);

  return (
    <nav
      className={`flex-1 overflow-y-auto ${
        collapsed ? "space-y-1 p-2" : "space-y-1 p-3"
      } ${className}`}
    >
      {navItems.map((item) => renderItem(item, 0, topLevelHrefs))}
    </nav>
  );
}
