"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Moon, Monitor, Sun } from "lucide-react";
import {
  Bars3Icon,
  ChevronDownIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { ActivityLogBell } from "@/components/layout/ActivityLogBell";
import { NotificationBell } from "@/components/hris/NotificationBell";
import { useTheme } from "@/components/providers/theme-provider";
import type { NavItem } from "@/lib/iam/types";
import { AppSidebarNavIcon } from "./app-sidebar-nav-icons";
import AppSidebarNav from "./app-sidebar-nav";
import { DashboardBreadcrumbs } from "./dashboard-breadcrumbs";

export interface SidebarUser {
  full_name: string;
  role: string;
  email?: string;
  company_name?: string | null;
  branch_name?: string | null;
}

export interface AppSidebarProps {
  user: SidebarUser;
  navItems: NavItem[];
  children: React.ReactNode;
}

const desktopNavItem: NavItem = {
  href: "/arkiv-os",
  label: "Kembali ke Desktop",
  icon: "home",
};

/** Tinggi bar atas desktop — sidebar header & navbar utama harus sama agar border sejajar */
const DESKTOP_TOP_BAR_HEIGHT = "lg:h-[4.75rem]";

export default function AppSidebar({ user, navItems, children }: AppSidebarProps) {
  const pathname = usePathname();
  const allNavItems = [desktopNavItem, ...navItems];
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const useActivityNotification = pathname.startsWith("/dashboard/purchasing");

  const closeMobile = () => setMobileOpen(false);

  return (
    <div
      className="arkiv-dashboard-theme flex min-h-screen"
      style={{ background: "var(--page-mesh)" }}
    >
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={closeMobile}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex transform flex-col bg-linear-to-br from-pink-50 to-white shadow-xl transition-all duration-200 ease-in-out lg:relative lg:z-0 lg:flex lg:shrink-0 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-20" : "lg:w-64"}`}
      >
        <SidebarHeader
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((prev) => !prev)}
          companyName={user.company_name}
          branchName={user.branch_name}
        />

        <AppSidebarNav navItems={allNavItems} collapsed={collapsed} onNavigate={closeMobile} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader
          navItems={navItems}
          onMenuClick={() => setMobileOpen(true)}
          userName={user.full_name}
          onAccountClick={() => setAccountOpen(true)}
        />

        <div
          className={`hidden items-center justify-between gap-4 border-b border-gray-100 bg-white/50 px-6 py-3 backdrop-blur-sm lg:flex ${DESKTOP_TOP_BAR_HEIGHT} lg:py-0`}
        >
          <DashboardBreadcrumbs navItems={navItems} className="max-w-[55%]" />
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/arkiv-os"
              className="inline-flex items-center gap-2 rounded-lg bg-pink-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-pink-700"
            >
              <AppSidebarNavIcon name="home" className="h-4 w-4" isActive />
              Desktop
            </Link>
            <ThemeToggle />
            {useActivityNotification ? <ActivityLogBell /> : <NotificationBell />}
            <div className="h-6 w-px bg-gray-200" />
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              className="inline-flex cursor-pointer items-center gap-3 rounded-xl border border-pink-100 bg-white px-3 py-2 text-left shadow-sm transition-colors hover:border-pink-200 hover:bg-pink-50"
              title="Klik untuk melihat akun login"
              aria-label="Buka popup akun login"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-pink-600 text-sm font-bold text-white">
                {user.full_name?.slice(0, 1).toUpperCase() || "A"}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-700">{user.full_name}</span>
                {user.email && (
                  <span className="block truncate text-xs text-gray-500">{user.email}</span>
                )}
              </span>
            </button>
          </div>
        </div>

        <main className="flex-1 overflow-auto p-4 transition-all duration-200 lg:p-6">{children}</main>

        {accountOpen && (
          <AccountPopup user={user} onClose={() => setAccountOpen(false)} />
        )}
      </div>
    </div>
  );
}

function SidebarHeader({
  collapsed,
  onToggleCollapse,
  companyName,
  branchName,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  companyName?: string | null;
  branchName?: string | null;
}) {
  return (
    <div
      className={`relative flex shrink-0 items-center border-b border-gray-100 bg-white/50 backdrop-blur-sm ${
        collapsed ? "justify-center px-2 py-3.5" : "px-3 py-4"
      } ${DESKTOP_TOP_BAR_HEIGHT} lg:py-0`}
    >
      {!collapsed && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 lg:block"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <ChevronDownIcon className="h-4 w-4 -rotate-90" />
        </button>
      )}

      {collapsed ? (
        <div className="flex w-full flex-col items-center justify-center gap-1">
          <img
            src="/logos/logo.png"
            alt="Arkiv OS"
            className="h-9 w-9 object-contain"
          />
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 lg:block"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronDownIcon className="h-4 w-4 rotate-90" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 pr-7">
          <img
            src="/logos/logo.png"
            alt="Arkiv OS"
            className="h-16 w-auto max-w-[10rem] shrink-0 object-contain object-left"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <UserScopeLines
              companyName={companyName}
              branchName={branchName}
              variant="header"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MobileHeader({
  navItems,
  onMenuClick,
  userName,
  onAccountClick,
}: {
  navItems: NavItem[];
  onMenuClick: () => void;
  userName: string;
  onAccountClick: () => void;
}) {
  return (
    <header className="border-b border-gray-200 bg-white lg:hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button onClick={onMenuClick} className="shrink-0 rounded-lg p-2 hover:bg-gray-100">
          <Bars3Icon className="h-6 w-6 text-gray-700" />
        </button>
        <button
          onClick={onAccountClick}
          className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-pink-50"
        >
          {userName}
        </button>
        <ThemeToggle compact />
        <Link href="/arkiv-os" className="shrink-0 font-semibold text-pink-600">
          Desktop
        </Link>
      </div>
      <div className="border-t border-gray-100 px-4 py-2">
        <DashboardBreadcrumbs navItems={navItems} />
      </div>
    </header>
  );
}

const THEME_MODES = [
  { value: "light" as const, icon: Sun, label: "Terang" },
  { value: "dark" as const, icon: Moon, label: "Gelap" },
  { value: "auto" as const, icon: Monitor, label: "Auto" },
];

function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { state, setMode } = useTheme();
  const currentIdx = THEME_MODES.findIndex((m) => m.value === state.mode);
  const current = THEME_MODES[currentIdx] ?? THEME_MODES[0];
  const next = THEME_MODES[(currentIdx + 1) % THEME_MODES.length];
  const Icon = current.icon;

  return (
    <Link
      href="/dashboard/settings/appearance"
      className="arkiv-theme-toggle group inline-flex items-center gap-2 rounded-lg border border-pink-100 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:border-pink-200 hover:bg-pink-50"
      title="Ubah tema"
      aria-label="Ubah tema tampilan"
      onClick={(e) => {
        e.preventDefault();
        setMode(next.value);
      }}
    >
      <Icon className="h-4 w-4" />
      {!compact && <span>{current.label}</span>}
    </Link>
  );
}

function UserScopeLines({
  companyName,
  branchName,
  compact = false,
  variant = "default",
}: {
  companyName?: string | null;
  branchName?: string | null;
  compact?: boolean;
  variant?: "default" | "header";
}) {
  const company = companyName?.trim() || "—";
  const branch = branchName?.trim() || null;
  const showBranch = Boolean(branch && branch !== company);

  if (compact) {
    return (
      <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">
        {showBranch ? `${company} · ${branch}` : company}
      </span>
    );
  }

  if (variant === "header") {
    return (
      <div className="space-y-1">
        <p className="truncate text-[15px] font-bold tracking-tight text-gray-900">
          {company}
        </p>
        {showBranch && (
          <p className="truncate text-xs font-medium text-gray-600">{branch}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="truncate text-sm font-semibold text-gray-900">{company}</p>
      {showBranch && <p className="truncate text-xs text-gray-600">{branch}</p>}
    </div>
  );
}

function AccountPopup({
  user,
  onClose,
}: {
  user: SidebarUser;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/20 p-4 pt-16 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-pink-100 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Akun Login</h2>
            <p className="text-xs text-gray-500">Session aktif Arkiv OS</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          <div className="mb-5 rounded-2xl border border-pink-100 bg-pink-50 p-4 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-pink-600 text-lg font-bold text-white">
              {user.full_name?.slice(0, 1).toUpperCase() || "A"}
            </div>
            <div className="font-semibold text-gray-900">{user.full_name}</div>
            {user.email && <div className="mt-1 text-sm text-gray-600">{user.email}</div>}
            <div className="mt-2 inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold capitalize text-pink-600 ring-1 ring-pink-100">
              {user.role.replace("_", " ")}
            </div>
          </div>

          <div className="mb-5 rounded-xl border border-gray-200/70 bg-gray-50/80 px-4 py-3">
            <UserScopeLines
              companyName={user.company_name}
              branchName={user.branch_name}
            />
          </div>

          <div className="grid gap-2">
            <Link
              href="/arkiv-os"
              onClick={onClose}
              className="flex items-center justify-center gap-2 rounded-xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white hover:bg-pink-700"
            >
              <AppSidebarNavIcon name="home" className="h-5 w-5" isActive />
              Kembali ke Desktop
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
