"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { buildNavBreadcrumbs } from "@/lib/iam/nav-breadcrumbs";
import { useNavFrom } from "@/lib/iam/use-nav-from";
import type { NavItem } from "@/lib/iam/types";

interface DashboardBreadcrumbsProps {
  navItems: NavItem[];
  className?: string;
}

export function DashboardBreadcrumbs({ navItems, className = "" }: DashboardBreadcrumbsProps) {
  const pathname = usePathname();
  const navFrom = useNavFrom();
  const items = useMemo(
    () => buildNavBreadcrumbs(navItems, pathname, navFrom),
    [navItems, pathname, navFrom]
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className={`min-w-0 flex-1 truncate text-sm ${className}`}
    >
      <ol className="flex min-w-0 items-center gap-1">
        {items.map((crumb, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {!isLast && crumb.href ? (
                <Link
                  href={crumb.href}
                  className="truncate text-gray-500 transition-colors hover:text-pink-600"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={`truncate ${isLast ? "font-medium text-gray-900" : "text-gray-400"}`}
                  aria-current={isLast ? "page" : undefined}
                >
                  {crumb.label}
                </span>
              )}
              {!isLast && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
