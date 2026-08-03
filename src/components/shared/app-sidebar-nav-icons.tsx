"use client";

import type { ElementType } from "react";
import type { NavIconName } from "@/lib/iam/types";
import {
  ArrowDownOnSquareIcon,
  ArrowRightStartOnRectangleIcon,
  BanknotesIcon,
  BookOpenIcon,
  BriefcaseIcon,
  BuildingOffice2Icon,
  BuildingOfficeIcon,
  CalendarIcon,
  ChartBarIcon,
  ChartPieIcon,
  CheckCircleIcon,
  CircleStackIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  CubeIcon,
  CurrencyDollarIcon,
  DocumentMagnifyingGlassIcon,
  DocumentTextIcon,
  HomeIcon,
  IdentificationIcon,
  MegaphoneIcon,
  PaperAirplaneIcon,
  PlusIcon,
  ShoppingCartIcon,
  StarIcon,
  TicketIcon,
  TruckIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import {
  ArrowDownOnSquareIcon as ArrowDownOnSquareIconSolid,
  BanknotesIcon as BanknotesIconSolid,
  BookOpenIcon as BookOpenIconSolid,
  BriefcaseIcon as BriefcaseIconSolid,
  BuildingOffice2Icon as BuildingOffice2IconSolid,
  BuildingOfficeIcon as BuildingOfficeIconSolid,
  CalendarIcon as CalendarIconSolid,
  ChartBarIcon as ChartBarIconSolid,
  ChartPieIcon as ChartPieIconSolid,
  CheckCircleIcon as CheckCircleIconSolid,
  CircleStackIcon as CircleStackIconSolid,
  ClipboardDocumentCheckIcon as ClipboardDocumentCheckIconSolid,
  ClipboardDocumentListIcon as ClipboardIconSolid,
  Cog6ToothIcon as CogIconSolid,
  CubeIcon as CubeIconSolid,
  CurrencyDollarIcon as DollarIconSolid,
  DocumentMagnifyingGlassIcon as DocumentMagnifyingGlassIconSolid,
  DocumentTextIcon as DocumentTextIconSolid,
  HomeIcon as HomeIconSolid,
  IdentificationIcon as IdentificationIconSolid,
  MegaphoneIcon as MegaphoneIconSolid,
  PaperAirplaneIcon as PaperAirplaneIconSolid,
  PlusIcon as PlusIconSolid,
  ShoppingCartIcon as ShoppingCartIconSolid,
  StarIcon as StarIconSolid,
  TicketIcon as TicketIconSolid,
  TruckIcon as TruckIconSolid,
  UsersIcon as UsersIconSolid,
} from "@heroicons/react/24/solid";

type IconSet = {
  outline: ElementType;
  solid: ElementType;
};

const iconMap: Record<NavIconName, IconSet> = {
  home: { outline: HomeIcon, solid: HomeIconSolid },
  users: { outline: UsersIcon, solid: UsersIconSolid },
  clipboard: { outline: ClipboardDocumentListIcon, solid: ClipboardIconSolid },
  star: { outline: StarIcon, solid: StarIconSolid },
  chart: { outline: ChartBarIcon, solid: ChartBarIconSolid },
  settings: { outline: Cog6ToothIcon, solid: CogIconSolid },
  logout: { outline: ArrowRightStartOnRectangleIcon, solid: ArrowRightStartOnRectangleIcon },
  briefcase: { outline: BriefcaseIcon, solid: BriefcaseIconSolid },
  shopping: { outline: ShoppingCartIcon, solid: ShoppingCartIconSolid },
  cube: { outline: CubeIcon, solid: CubeIconSolid },
  pr: { outline: DocumentTextIcon, solid: DocumentTextIconSolid },
  po: { outline: ClipboardDocumentCheckIcon, solid: ClipboardDocumentCheckIconSolid },
  reports: { outline: BookOpenIcon, solid: BookOpenIconSolid },
  sitemap: { outline: BuildingOffice2Icon, solid: BuildingOffice2IconSolid },
  database: { outline: CircleStackIcon, solid: CircleStackIconSolid },
  building: { outline: BuildingOfficeIcon, solid: BuildingOfficeIconSolid },
  identification: { outline: IdentificationIcon, solid: IdentificationIconSolid },
  calendar: { outline: CalendarIcon, solid: CalendarIconSolid },
  "dollar-sign": { outline: CurrencyDollarIcon, solid: DollarIconSolid },
  money: { outline: CurrencyDollarIcon, solid: DollarIconSolid },
  "user-plus": { outline: UsersIcon, solid: UsersIconSolid },
  "file-text": { outline: DocumentTextIcon, solid: DocumentTextIconSolid },
  "chart-bar": { outline: ChartBarIcon, solid: ChartBarIconSolid },
  plus: { outline: PlusIcon, solid: PlusIconSolid },
  "paper-airplane": { outline: PaperAirplaneIcon, solid: PaperAirplaneIconSolid },
  "check-circle": { outline: CheckCircleIcon, solid: CheckCircleIconSolid },
  "chart-pie": { outline: ChartPieIcon, solid: ChartPieIconSolid },
  "arrow-down-on-square": { outline: ArrowDownOnSquareIcon, solid: ArrowDownOnSquareIconSolid },
  truck: { outline: TruckIcon, solid: TruckIconSolid },
  "document-magnifying-glass": {
    outline: DocumentMagnifyingGlassIcon,
    solid: DocumentMagnifyingGlassIconSolid,
  },
  "circle-stack": { outline: CircleStackIcon, solid: CircleStackIconSolid },
  "document-text": { outline: DocumentTextIcon, solid: DocumentTextIconSolid },
  "clipboard-document-check": {
    outline: ClipboardDocumentCheckIcon,
    solid: ClipboardDocumentCheckIconSolid,
  },
  megaphone: { outline: MegaphoneIcon, solid: MegaphoneIconSolid },
  banknotes: { outline: BanknotesIcon, solid: BanknotesIconSolid },
  ticket: { outline: TicketIcon, solid: TicketIconSolid },
};

export function AppSidebarNavIcon({
  name,
  className = "h-5 w-5",
  isActive,
}: {
  name: NavIconName;
  className?: string;
  isActive: boolean;
}) {
  const entry = iconMap[name] ?? iconMap.clipboard;
  const Icon = isActive ? entry.solid : entry.outline;
  return <Icon className={className} />;
}
