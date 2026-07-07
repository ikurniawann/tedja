"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  LayoutDashboardIcon,
  PackageIcon,
  ShoppingCartIcon,
  ClipboardListIcon,
  UserCircle,
  Coins,
  ChefHat,
  Calendar,
  LogOut,
  Printer,
  SlidersHorizontal,
  Table2,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { ActivityLogBell } from "@/components/layout/ActivityLogBell";
import { ShiftModal } from "@/components/pos/ShiftModal";
import { createBrowserClient } from "@/lib/pg/browser-client";
import { usePosShift } from "@/hooks/use-pos-shift";
import { formatAmount } from "@/lib/purchasing/utils";
import { POS_SHIFT_MANAGEMENT_ENABLED } from "@/lib/pos/feature-flags";
import { useState } from "react";
import type { NavItem } from "@/lib/iam/types";

const CASHIER_ID = "00000000-0000-0000-0000-000000000001";

/** Peta nama ikon (dari iam.menus) ke komponen lucide untuk top-navbar POS. */
const POS_ICON_MAP: Record<string, typeof LayoutDashboardIcon> = {
  home: LayoutDashboardIcon,
  cube: PackageIcon,
  shopping: ShoppingCartIcon,
  clipboard: ClipboardListIcon,
  chart: TrendingUp,
  calendar: Calendar,
  money: Coins,
  "document-text": Printer,
  settings: SlidersHorizontal,
  "open-bills": Table2,
  kds: ChefHat,
  topup: Coins,
  "alert-triangle": AlertTriangle,
};

function clsx(...args: (string | boolean | undefined | null)[]) {
  return args.filter(Boolean).join(" ");
}

export function PosLayout({
  items,
  backOfficeHref = "/arkiv-os",
  children,
}: {
  items: NavItem[];
  backOfficeHref?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const db = createBrowserClient();
  const { shift, isActive: hasShift, loading: loadingShift, openShift, closeShift } = usePosShift(CASHIER_ID);
  const [showShiftModal, setShowShiftModal] = useState(false);

  const handleLogout = async () => {
    await db.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div>
      {/* Horizontal Navigation Bar */}
      <div className="sticky top-0 z-40 w-full bg-white border-b border-gray-200">
        <div className="flex h-14 items-center justify-between px-3 sm:px-4">
          {/* Left - Logo + Navigation tabs */}
          <div className="flex items-center gap-3 flex-1 overflow-x-auto scrollbar-hide">
            <Link
              href={backOfficeHref}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200/70 px-2.5 text-xs font-medium text-gray-700 transition-colors hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700 sm:px-3 sm:text-sm"
              title="Back to Back Office"
            >
              <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Back Office</span>
            </Link>
            <Image
              src="/logo.png"
              alt="Prologue Wonderland"
              width={120}
              height={32}
              className="h-8 w-auto flex-shrink-0 object-contain"
              priority
            />
            {items.map((item) => {
              const active = pathname === item.href;
              const Icon = POS_ICON_MAP[item.icon] ?? ClipboardListIcon;
              return (
                <Link
                  key={`${item.href}:${item.label}`}
                  href={item.href}
                  className={clsx(
                    "flex items-center gap-1.5 px-2 sm:px-3 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                    active
                      ? "border-pink-600 text-pink-600"
                      : "border-transparent text-gray-900 hover:text-pink-600 hover:border-pink-400"
                  )}
                >
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Right - Bell icon, user profile, logout */}
          <div className="flex items-center gap-2 sm:gap-4 pl-2 sm:pl-4 border-l border-gray-200 flex-shrink-0">
            <ActivityLogBell
              posShift={
                POS_SHIFT_MANAGEMENT_ENABLED
                  ? {
                      isActive: hasShift,
                      loading: loadingShift,
                      shiftNumber: shift?.shift_number,
                      totalOrders: shift?.total_orders || 0,
                      totalSales: shift?.total_sales || 0,
                      onClick: () => setShowShiftModal(true),
                      formatCurrency: formatAmount,
                    }
                  : undefined
              }
            />
            {POS_SHIFT_MANAGEMENT_ENABLED ? (
              <button
                type="button"
                onClick={() => setShowShiftModal(true)}
                className={clsx(
                  "hidden sm:inline-flex h-8 items-center rounded-lg border px-3 text-xs font-semibold transition-colors",
                  hasShift
                    ? "border-green-200/80 bg-green-50 text-green-700 hover:bg-green-100"
                    : "border-amber-200/80 bg-amber-50 text-amber-700 hover:bg-amber-100"
                )}
              >
                {hasShift ? "Close Shift" : "Open Shift"}
              </button>
            ) : null}
            <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-900">
              <UserCircle className="w-4 h-4 sm:w-5 sm:h-5 text-gray-900" />
              <span className="hidden md:inline-block font-medium">User</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Keluar"
            >
              <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden md:inline-block">Keluar</span>
            </button>
          </div>
        </div>
      </div>

      {/* Page content */}
      <main className="p-3 sm:p-6">
        {children}
      </main>

      {POS_SHIFT_MANAGEMENT_ENABLED ? (
        <ShiftModal
          open={showShiftModal}
          shift={shift}
          onClose={() => setShowShiftModal(false)}
          onOpenShift={openShift}
          onCloseShift={closeShift}
        />
      ) : null}
    </div>
  );
}
