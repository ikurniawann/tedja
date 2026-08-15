"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { isNavLinkActive } from "@/lib/iam/nav-active";
import { useNavFrom } from "@/lib/iam/use-nav-from";
import type { NavItem } from "@/lib/iam/types";
import { isPosChromeLessPath } from "@/features/pos/tablet-mode";
import { AppSidebarNavIcon } from "./app-sidebar-nav-icons";

interface AppSidebarNavProps {
  navItems: NavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
}

/**
 * Href ESS yang otomatis ditandai "sudah dilihat" begitu dibuka, sehingga
 * badge pembaruannya langsung hilang tanpa aksi tambahan dari karyawan.
 * Kunci map = href, nilai = nama modul di API.
 */
const ESS_SEEN_ON_VISIT: Record<string, string> = {
  "/dashboard/me/cuti": "leaves",
  "/dashboard/me/lembur": "overtime",
  "/dashboard/me/pinjaman": "loans",
};

function navItemKey(item: NavItem): string {
  return `${item.href}::${item.label}`;
}

/** Flatten every leaf href so prefix active-checks can see cousins (e.g. /dashboard/pos vs /dashboard/pos/tables). */
function collectLeafHrefs(items: NavItem[]): string[] {
  const hrefs: string[] = [];
  for (const item of items) {
    if (item.children?.length) {
      hrefs.push(...collectLeafHrefs(item.children));
    } else if (item.href) {
      hrefs.push(item.href);
    }
  }
  return hrefs;
}

function collectActiveGroupKeys(
  items: NavItem[],
  pathname: string,
  navFrom: string | null,
  allLeafHrefs: string[],
  ancestors: string[] = []
): string[] {
  const keys: string[] = [];

  for (const item of items) {
    const selfActive = isNavLinkActive(pathname, item.href, allLeafHrefs, navFrom);
    const childActive = item.children?.some((child) =>
      isNavLinkActive(pathname, child.href, allLeafHrefs, navFrom)
    );
    const itemKey = navItemKey(item);

    if (item.children?.length && (selfActive || childActive)) {
      keys.push(...ancestors, itemKey);
    }

    if (item.children?.length) {
      keys.push(
        ...collectActiveGroupKeys(item.children, pathname, navFrom, allLeafHrefs, [
          ...ancestors,
          itemKey,
        ])
      );
    }
  }

  return keys;
}

function isGroupActive(
  item: NavItem,
  pathname: string,
  navFrom: string | null,
  allLeafHrefs: string[]
): boolean {
  if (!item.children?.length) {
    return isNavLinkActive(pathname, item.href, allLeafHrefs, navFrom);
  }

  return (
    pathname === item.href ||
    item.children.some((child) =>
      isNavLinkActive(pathname, child.href, allLeafHrefs, navFrom)
    )
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
  const allLeafHrefs = useMemo(() => collectLeafHrefs(navItems), [navItems]);
  const autoExpanded = useMemo(
    () => [...new Set(collectActiveGroupKeys(navItems, pathname, navFrom, allLeafHrefs))],
    [navItems, pathname, navFrom, allLeafHrefs]
  );
  const [expandedMenus, setExpandedMenus] = useState<string[]>(autoExpanded);

  useEffect(() => {
    setExpandedMenus((prev) => [...new Set([...prev, ...autoExpanded])]);
  }, [autoExpanded]);

  /**
   * Badge notifikasi: antrean persetujuan (HR) dan pembaruan pengajuan (ESS).
   * Satu permintaan untuk semua menu; server yang memutuskan angka mana yang
   * boleh dilihat aktor ini.
   */
  const [badges, setBadges] = useState<Record<string, number>>({});
  const loadBadges = useCallback(async () => {
    try {
      const res = await fetch("/api/hris/nav-badges");
      if (!res.ok) return;
      const json = await res.json();
      setBadges(json?.badges ?? {});
    } catch {
      // Badge hiasan — diamkan agar navigasi tetap utuh saat jaringan gagal.
    }
  }, []);

  useEffect(() => {
    // Dimuat ulang tiap pindah halaman agar angkanya menyusul aksi pengguna.
    void loadBadges();
  }, [loadBadges, pathname]);

  // Membuka halaman ESS berarti karyawan sudah melihat pembaruannya.
  useEffect(() => {
    const module = ESS_SEEN_ON_VISIT[pathname];
    if (!module) return;
    let active = true;
    fetch("/api/hris/nav-badges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module }),
    })
      .then(() => {
        if (active) void loadBadges();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pathname, loadBadges]);

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
        ? "bg-[var(--sidebar-active-background)] font-semibold text-[var(--sidebar-active-foreground)] shadow-sm"
        : "text-[var(--sidebar-foreground)]/90 hover:bg-[color-mix(in_srgb,var(--sidebar-active-background)_10%,transparent)] hover:text-[var(--sidebar-active-background)]",
      extra,
    ]
      .filter(Boolean)
      .join(" ");

  const topLevelGroupClass = (itemActive: boolean, extra = "") =>
    [
      "flex w-full items-center rounded-lg text-sm transition-colors",
      collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
      itemActive
        ? "font-semibold text-[var(--sidebar-active-background)]"
        : "text-[var(--sidebar-foreground)]/90 hover:bg-[color-mix(in_srgb,var(--sidebar-active-background)_10%,transparent)] hover:text-[var(--sidebar-active-background)]",
      extra,
    ]
      .filter(Boolean)
      .join(" ");

  const submenuItemClass = (
    itemActive: boolean,
    hasChildren: boolean,
    extra = ""
  ) => {
    const base =
      "relative flex w-full items-center rounded-md py-2 pl-3 pr-2 text-sm transition-colors";

    if (hasChildren) {
      return [
        base,
        "justify-between",
        itemActive
          ? "font-medium text-foreground"
          : "font-normal text-foreground/75",
        "hover:bg-[color-mix(in_srgb,var(--sidebar-active-background)_10%,transparent)] hover:text-[var(--sidebar-active-background)]",
        extra,
      ]
        .filter(Boolean)
        .join(" ");
    }

    return [
      base,
      itemActive
        ? [
            "bg-[color-mix(in_srgb,var(--sidebar-active-background)_12%,transparent)] font-medium text-[var(--sidebar-active-background)]",
            "before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px]",
            "before:-translate-y-1/2 before:rounded-r-full before:bg-[var(--sidebar-active-background)]",
          ].join(" ")
        : "font-normal text-[var(--sidebar-foreground)]/70 hover:bg-[color-mix(in_srgb,var(--sidebar-active-background)_8%,transparent)] hover:text-[var(--sidebar-active-background)]",
      extra,
    ]
      .filter(Boolean)
      .join(" ");
  };

  /**
   * Total badge sebuah cabang. Tanpa ini, notifikasi pada anak menu tidak
   * terlihat sama sekali selama grupnya masih tertutup.
   */
  const branchBadgeTotal = (item: NavItem): number => {
    if (item.children?.length) {
      return item.children.reduce((sum, child) => sum + branchBadgeTotal(child), 0);
    }
    return item.href ? (badges[item.href] ?? 0) : 0;
  };

  const renderItem = (item: NavItem, depth = 0) => {
    const hasChildren = Boolean(item.children?.length);
    const itemActive = hasChildren
      ? isGroupActive(item, pathname, navFrom, allLeafHrefs)
      : isNavLinkActive(pathname, item.href, allLeafHrefs, navFrom);
    const itemKey = navItemKey(item);
    const isExpanded = expandedMenus.includes(itemKey);
    const showIcon = depth === 0;
    const isSubmenu = depth > 0;

    if (hasChildren) {
      const groupShellClass = isSubmenu
        ? submenuItemClass(itemActive, true)
        : topLevelGroupClass(itemActive, collapsed ? "" : "justify-between");

      return (
        <div key={itemKey}>
          <button
            type="button"
            onClick={() => toggleMenu(itemKey)}
            aria-expanded={isExpanded}
            className={`relative ${groupShellClass}`}
            title={collapsed ? item.label : undefined}
          >
            {collapsed && branchBadgeTotal(item) > 0 && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--sidebar-active-background)]" />
            )}
            {collapsed ? (
              showIcon ? (
                <AppSidebarNavIcon name={item.icon} isActive={false} />
              ) : (
                <span className="truncate text-xs font-normal">{item.label}</span>
              )
            ) : (
              <>
                <span
                  className={`flex min-w-0 flex-1 items-center text-left ${showIcon ? "gap-3" : ""}`}
                >
                  {showIcon && <AppSidebarNavIcon name={item.icon} isActive={false} />}
                  <span className="truncate">{item.label}</span>
                </span>
                {!isExpanded && branchBadgeTotal(item) > 0 && (
                  <span className="ml-auto mr-1 min-w-5 rounded-full bg-[var(--sidebar-active-background)] px-1.5 text-center text-[11px] font-bold leading-5 text-[var(--sidebar-active-foreground)]">
                    {branchBadgeTotal(item) > 99 ? "99+" : branchBadgeTotal(item)}
                  </span>
                )}
                <ChevronDownIcon
                  className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              </>
            )}
          </button>
          {isExpanded && !collapsed && (
            <div className="ml-3 mt-1 space-y-0.5 border-l border-gray-200/70 pl-3">
              {item.children!.map((child) => renderItem(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const leafShellClass = isSubmenu
      ? submenuItemClass(itemActive, false)
      : topLevelItemClass(itemActive);

    const badgeCount =
      item.href && badges[item.href] > 0
        ? badges[item.href]
        : 0;

    const leafClassName = `relative ${leafShellClass}`;
    const leafTitle = collapsed ? item.label : undefined;
    const leafInner = (
      <>
        {showIcon && <AppSidebarNavIcon name={item.icon} isActive={itemActive} />}
        {!collapsed && <span className="flex-1">{item.label}</span>}
        {badgeCount > 0 &&
          (collapsed ? (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--sidebar-active-background)]" />
          ) : (
            <span className="ml-auto min-w-5 rounded-full bg-[var(--sidebar-active-background)] px-1.5 text-center text-[11px] font-bold leading-5 text-[var(--sidebar-active-foreground)]">
              {badgeCount > 99 ? "99+" : badgeCount}
            </span>
          ))}
      </>
    );

    // /pos/kds, /pos/queue, CFD: beda root layout → <Link> RSC fetch TypeError.
    if (isPosChromeLessPath(item.href)) {
      return (
        <a
          key={itemKey}
          href={item.href}
          onClick={onNavigate}
          className={leafClassName}
          title={leafTitle}
        >
          {leafInner}
        </a>
      );
    }

    return (
      <Link
        key={itemKey}
        href={item.href}
        onClick={onNavigate}
        className={leafClassName}
        title={leafTitle}
      >
        {leafInner}
      </Link>
    );
  };

  return (
    <nav
      className={`flex-1 overflow-y-auto ${
        collapsed ? "space-y-1 p-2" : "space-y-1 p-3"
      } ${className}`}
    >
      {navItems.map((item) => renderItem(item, 0))}
    </nav>
  );
}
