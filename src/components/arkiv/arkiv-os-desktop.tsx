"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { extractSseData, splitSseEvents } from "@/lib/assistant/sse";
import {
  DesktopMonitorBoard,
  MONITOR_WIDGETS,
  NotificationPopups,
  normalizeWidgetOrder,
  useDesktopOverview,
  type MonitorWidgetKey,
} from "./desktop-monitor";
import type { DesktopOverview as DesktopOverviewData } from "@/lib/desktop/overview";
import { WaNotifSettingsPanel } from "./wa-notif-settings";
import {
  MAX_NOTIFICATION_HISTORY,
  diffOverviewNotifications,
  type ActivityNotification,
} from "@/lib/desktop/notifications";
import type { ComponentType, CSSProperties, FormEvent as ReactFormEvent, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Bell,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cloud,
  Command,
  Copy,
  CreditCard,
  ExternalLink,
  Folder,
  Gamepad2,
  Grid3X3,
  History,
  Landmark,
  Plus,
  Loader2,
  LogIn,
  Plug,
  MessageSquareMore,
  MonitorDot,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Scale,
  Trash2,
  Volume2,
  WalletCards,
  VolumeX,
  UsersRound,
  Wifi,
  X,
} from "lucide-react";
import { createBrowserClient } from "@/lib/pg/browser-client";
import {
  AI_ASSISTANT_MODELS,
  AI_ASSISTANT_SCOPES,
  AI_ASSISTANT_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_ASSISTANT_SETTINGS,
  type AiAssistantSettings,
  resolveAiAssistantModel,
  resolveAiAssistantScope,
} from "@/lib/ai-assistant-config";

type OsUserAccount = {
  email: string;
  fullName: string;
  role: string;
};

type DesktopModule = {
  name: string;
  subtitle: string;
  description: string;
  loginHref: string;
  dashboardHref: string;
  externalHref?: string;
  icon: ComponentType<{ className?: string }>;
  disabled?: boolean;
};

type DesktopIconPosition = { left: number; top: number };
type WidgetVisibility = { calendar: boolean } & Record<MonitorWidgetKey, boolean>;

const pinkAccent = "from-pink-300 via-pink-500 to-rose-600";

const modules: DesktopModule[] = [
  {
    name: "HRIS",
    subtitle: "Human Resources",
    description: "Talent pool, employee lifecycle, attendance, payroll, KPI, dan performance review.",
    loginHref: "/login?redirect=/dashboard/hris&module=hris",
    dashboardHref: "/dashboard/hris",
    icon: UsersRound,
  },
  {
    name: "Procurement",
    subtitle: "Purchasing Control",
    description: "PR, PO, suppliers, GRN, QC, return, stock control, dan purchasing analytics.",
    loginHref: "/login?redirect=/dashboard/purchasing&module=purchasing",
    dashboardHref: "/dashboard/purchasing",
    icon: BriefcaseBusiness,
  },
  {
    name: "POS",
    subtitle: "Point of Sales",
    description: "Cashier, order, reservation, customer, product, dan outlet sales operation.",
    loginHref: "/login?redirect=/dashboard/pos&module=pos",
    dashboardHref: "/dashboard/pos",
    icon: ShoppingCart,
  },
  {
    name: "Integration",
    subtitle: "Settings Center",
    description: "Konfigurasi integrasi Game, Photobox, Payment Gateway, API, webhook, dan automation.",
    loginHref: "/login?redirect=/dashboard/integration&module=integration",
    dashboardHref: "/dashboard/integration",
    icon: Plug,
  },
  {
    name: "CRM",
    subtitle: "Membership & Loyalty",
    description: "Customer profile, membership tier, XP, reward, avatar collectible, dan loyalty analytics.",
    loginHref: "/login?redirect=/dashboard/crm&module=crm",
    dashboardHref: "/dashboard/crm",
    icon: MessageSquareMore,
  },
];

const wallpapers = [
  { id: "arkiv", name: "Arkiv Aurora", src: "/bg.avif" },
  { id: "pink", name: "Pink Dusk", src: "linear-gradient(135deg,#16091d,#5b1239 45%,#111827)" },
  { id: "midnight", name: "Midnight", src: "linear-gradient(135deg,#030712,#111827 52%,#1e1b4b)" },
  { id: "glass", name: "Glass Blue", src: "linear-gradient(135deg,#082f49,#0f172a 48%,#312e81)" },
];

const defaultWidgetVisibility: WidgetVisibility = {
  calendar: false,
  pulsa: true,
  tim: true,
  keputusan: true,
  stok: true,
  member: true,
};

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "2-digit", month: "short" }).format(date);
}

export default function ArkivOsDesktop() {
  const router = useRouter();
  const desktopRef = useRef<HTMLElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [previewModule, setPreviewModule] = useState<DesktopModule | null>(null);
  const [showCommand, setShowCommand] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showWaNotif, setShowWaNotif] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showApplicationFolder, setShowApplicationFolder] = useState(false);
  const [comingSoonApp, setComingSoonApp] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [userAccount, setUserAccount] = useState<OsUserAccount | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [showWallpaperPicker, setShowWallpaperPicker] = useState(false);
  const [showWidgetSettings, setShowWidgetSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [openAppModule, setOpenAppModule] = useState<DesktopModule | null>(null);
  const [moduleOpenChoice, setModuleOpenChoice] = useState<DesktopModule | null>(null);
  const [showAssistantShortcut, setShowAssistantShortcut] = useState(false);
  const [assistantShortcutInput, setAssistantShortcutInput] = useState("");
  const [queuedAssistantPrompt, setQueuedAssistantPrompt] = useState<string | null>(null);
  const [assistantShortcutFocused, setAssistantShortcutFocused] = useState(false);
  const [wallpaper, setWallpaper] = useState(wallpapers[0]);
  const [widgetVisibility, setWidgetVisibility] = useState<WidgetVisibility>(defaultWidgetVisibility);
  const [widgetOrder, setWidgetOrder] = useState<MonitorWidgetKey[]>(() => normalizeWidgetOrder(null));
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [assistantSettings, setAssistantSettings] = useState<AiAssistantSettings>(DEFAULT_AI_ASSISTANT_SETTINGS);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; module?: DesktopModule; desktop?: boolean } | null>(null);
  const assistantShortcutRef = useRef<HTMLFormElement>(null);
  const assistantShortcutInputRef = useRef<HTMLInputElement>(null);

  const motionStyle = {
    "--mouse-x": "50%",
    "--mouse-y": "50%",
    "--float-x": "0px",
    "--float-y": "0px",
    "--float-x-reverse": "0px",
    "--float-y-reverse": "0px",
    "--float-x-panel": "0px",
    "--float-y-panel": "0px",
    "--float-x-note": "0px",
    "--float-y-note": "0px",
  } as CSSProperties;

  const isLoggedIn = Boolean(userAccount);
  const overview = useDesktopOverview(isLoggedIn);
  // Notifikasi aktivitas: snapshot overview dibandingkan tiap poll; kenaikan
  // melahirkan popup + masuk riwayat Notification Center.
  const [notifHistory, setNotifHistory] = useState<ActivityNotification[]>([]);
  const [notifPopups, setNotifPopups] = useState<ActivityNotification[]>([]);
  const prevOverviewRef = useRef<DesktopOverviewData | null>(null);
  useEffect(() => {
    if (!overview.data) return;
    const fresh = diffOverviewNotifications(prevOverviewRef.current, overview.data);
    prevOverviewRef.current = overview.data;
    if (fresh.length === 0) return;
    setNotifHistory((prev) => [...fresh, ...prev].slice(0, MAX_NOTIFICATION_HISTORY));
    setNotifPopups((prev) => [...prev, ...fresh]);
  }, [overview.data]);
  const dismissPopup = useCallback((id: string) => {
    setNotifPopups((prev) => prev.filter((n) => n.id !== id));
  }, []);
  const openNotification = useCallback((n: ActivityNotification) => {
    setNotifPopups((prev) => prev.filter((item) => item.id !== n.id));
    router.push(n.href);
  }, [router]);
  const askDoFromWidget = useCallback((prompt: string) => {
    setQueuedAssistantPrompt(prompt);
    setShowAssistant(true);
  }, []);

  const filteredModules = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return modules;
    return modules.filter((module) => `${module.name} ${module.subtitle}`.toLowerCase().includes(normalized));
  }, [query]);

  const desktopIcons = useMemo(
    () => [
      { id: "assistant", name: "Do", subtitle: "Super User", icon: Bot, action: "assistant" as const },
      { id: "drive", name: "Arkiv Drive", subtitle: "Files", icon: Folder, action: "files" as const },
      { id: "Application", name: "Application", subtitle: "All Modules", icon: Grid3X3, action: "folder" as const },
      {
        id: "userManagement",
        name: "User Management",
        subtitle: "Super Admin",
        icon: ShieldCheck,
        action: "route" as const,
        href: "/dashboard/settings/users",
        loginHref: "/login?redirect=/dashboard/settings/users",
      },
    ],
    [],
  );

  const moduleHref = (module: DesktopModule) => module.externalHref ?? (isLoggedIn ? module.dashboardHref : module.loginHref);

  const openModule = (module: DesktopModule) => {
    if (module.disabled) return;
    setModuleOpenChoice(module);
  };

  const openModuleInArkivOs = (module: DesktopModule) => {
    const href = moduleHref(module);
    if (module.externalHref) {
      window.open(href, "_blank", "noopener,noreferrer");
      setModuleOpenChoice(null);
      return;
    }
    setOpenAppModule(module);
    setModuleOpenChoice(null);
  };

  const openModuleInNewTab = (module: DesktopModule) => {
    window.open(moduleHref(module), "_blank", "noopener,noreferrer");
    setModuleOpenChoice(null);
  };

  const openAssistantFromShortcut = useCallback((event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = assistantShortcutInput.trim();
    if (!message) return;

    setQueuedAssistantPrompt(message);
    setShowAssistant(true);
  }, [assistantShortcutInput]);

  const consumeQueuedAssistantPrompt = useCallback(() => {
    setQueuedAssistantPrompt(null);
  }, []);

  const handleMouseMove = (event: ReactMouseEvent<HTMLElement>) => {
    const element = desktopRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
    const floatX = (xPercent - 50) * 0.42;
    const floatY = (yPercent - 50) * 0.42;

    element.style.setProperty("--mouse-x", `${xPercent}%`);
    element.style.setProperty("--mouse-y", `${yPercent}%`);
    element.style.setProperty("--float-x", `${floatX}px`);
    element.style.setProperty("--float-y", `${floatY}px`);
    element.style.setProperty("--float-x-reverse", `${floatX * -1}px`);
    element.style.setProperty("--float-y-reverse", `${floatY * -1}px`);
    element.style.setProperty("--float-x-panel", `${floatX * 0.35}px`);
    element.style.setProperty("--float-y-panel", `${floatY * 0.35}px`);
    element.style.setProperty("--float-x-note", `${floatX * -0.25}px`);
    element.style.setProperty("--float-y-note", `${floatY * -0.25}px`);
  };

  const resetMouseMotion = () => {
    const element = desktopRef.current;
    if (!element) return;
    ["--float-x", "--float-y", "--float-x-reverse", "--float-y-reverse", "--float-x-panel", "--float-y-panel", "--float-x-note", "--float-y-note"].forEach((key) =>
      element.style.setProperty(key, "0px"),
    );
    element.style.setProperty("--mouse-x", "50%");
    element.style.setProperty("--mouse-y", "50%");
  };

  const updateWidgetVisibility = (key: keyof WidgetVisibility, value: boolean) => {
    const next = { ...widgetVisibility, [key]: value };
    setWidgetVisibility(next);
    window.localStorage.setItem("arkiv-widget-visibility", JSON.stringify(next));
  };

  /** Geser widget monitoring satu langkah ke atas/bawah (Fase C). */
  const moveWidget = (key: MonitorWidgetKey, direction: -1 | 1) => {
    const index = widgetOrder.indexOf(key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= widgetOrder.length) return;
    const next = [...widgetOrder];
    [next[index], next[target]] = [next[target], next[index]];
    setWidgetOrder(next);
    window.localStorage.setItem("arkiv-widget-order", JSON.stringify(next));
  };

  const updateSoundEnabled = (value: boolean) => {
    setSoundEnabled(value);
    window.localStorage.setItem("arkiv-sound-enabled", String(value));
  };

  const updateAssistantSettings = (next: Partial<AiAssistantSettings>) => {
    const settings = { ...assistantSettings, ...next };
    setAssistantSettings(settings);
    window.localStorage.setItem(AI_ASSISTANT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  };

  const playClickSound = () => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 520;
      gain.gain.setValueAtTime(0.025, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.06);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.06);
      window.setTimeout(() => context.close(), 120);
    } catch {
      // ignore unavailable audio context
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      const savedWallpaper = window.localStorage.getItem("arkiv-wallpaper");
      const savedWidgets = window.localStorage.getItem("arkiv-widget-visibility");
      const savedOrder = window.localStorage.getItem("arkiv-widget-order");
      if (savedOrder) {
        try {
          setWidgetOrder(normalizeWidgetOrder(JSON.parse(savedOrder)));
        } catch {
          window.localStorage.removeItem("arkiv-widget-order");
        }
      }
      const savedSound = window.localStorage.getItem("arkiv-sound-enabled");
      const savedAssistantSettings = window.localStorage.getItem(AI_ASSISTANT_SETTINGS_STORAGE_KEY);
      if (savedWallpaper) setWallpaper(wallpapers.find((item) => item.id === savedWallpaper) ?? wallpapers[0]);
      if (savedWidgets) {
        const parsedWidgets = JSON.parse(savedWidgets);
        const nextWidgets = { ...defaultWidgetVisibility, ...parsedWidgets };
        setWidgetVisibility(nextWidgets);
        window.localStorage.setItem("arkiv-widget-visibility", JSON.stringify(nextWidgets));
      } else {
        window.localStorage.setItem("arkiv-widget-visibility", JSON.stringify(defaultWidgetVisibility));
      }
      setSoundEnabled(savedSound === "true");
      if (savedAssistantSettings) {
        try {
          const parsed = JSON.parse(savedAssistantSettings) as Partial<AiAssistantSettings>;
          const nextSettings = {
            model: resolveAiAssistantModel(parsed.model),
            scope: resolveAiAssistantScope(parsed.scope),
          };
          setAssistantSettings(nextSettings);
          window.localStorage.setItem(AI_ASSISTANT_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
        } catch {
          window.localStorage.setItem(AI_ASSISTANT_SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_AI_ASSISTANT_SETTINGS));
        }
      } else {
        window.localStorage.setItem(AI_ASSISTANT_SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_AI_ASSISTANT_SETTINGS));
      }
    }, 0);
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const db = createBrowserClient();

    db.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setUserAccount(null);
        return;
      }

      const { data: profile } = await db
        .from("users")
        .select("full_name, role")
        .eq("id", data.user.id)
        .single();

      setUserAccount({
        email: data.user.email ?? "",
        fullName: profile?.full_name ?? data.user.email ?? "Arkiv User",
        role: profile?.role ?? "authenticated",
      });
    });
  }, []);

  useEffect(() => {
    if (!showAssistantShortcut) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (assistantShortcutRef.current?.contains(target)) return;

      setShowAssistantShortcut(false);
      setAssistantShortcutFocused(false);
    };

    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, [showAssistantShortcut]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowCommand(true);
      }
      const isAssistantShortcut =
        event.metaKey &&
        event.shiftKey &&
        (event.key.toLowerCase() === "a" || event.code === "KeyA");
      if (isAssistantShortcut) {
        event.preventDefault();
        event.stopPropagation();
        setShowAssistantShortcut(true);
        window.requestAnimationFrame(() => assistantShortcutInputRef.current?.focus());
      }
      if (event.key === "Escape") {
        setShowCommand(false);
        setShowLibrary(false);
        setShowNotifications(false);
        setShowAssistantShortcut(false);
        setAssistantShortcutFocused(false);
        setContextMenu(null);
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, []);

  return (
    <main
      ref={desktopRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={resetMouseMotion}
      onClick={() => setContextMenu(null)}
      onClickCapture={playClickSound}
      onContextMenu={(event) => {
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY, desktop: true });
      }}
      style={motionStyle}
      className="relative min-h-dvh overflow-hidden bg-[#0b1020] text-white"
    >
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={wallpaper.src.startsWith("/") ? { backgroundImage: `url('${wallpaper.src}')` } : { background: wallpaper.src }}
      />
      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute inset-0 opacity-[0.16] transition-transform duration-500 ease-out [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:80px_80px] [transform:translate3d(var(--float-x-reverse),var(--float-y-reverse),0)]" />
      <div className="pointer-events-none absolute -left-24 top-24 size-72 rounded-full bg-cyan-300/14 blur-3xl transition-transform duration-500 ease-out [transform:translate3d(var(--float-x),var(--float-y),0)]" />
      <div className="pointer-events-none absolute -right-24 bottom-16 size-80 rounded-full bg-pink-400/14 blur-3xl transition-transform duration-500 ease-out [transform:translate3d(var(--float-x-reverse),var(--float-y-reverse),0)]" />
      <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-white/10 to-transparent" />

      <header className="fixed inset-x-0 top-0 z-30 flex h-9 items-center justify-between border-b border-white/10 bg-black/22 px-3 text-[13px] text-white/90 backdrop-blur-2xl">
        <div className="flex h-full items-center gap-5">
          <button
            type="button"
            onClick={() => setShowAccount(true)}
            className="flex items-center gap-2 font-semibold transition hover:text-white"
            title="Account"
          >
            <span className="grid size-5 place-items-center rounded-md bg-white/15 text-[10px] uppercase">
              {userAccount?.email?.charAt(0) || "A"}
            </span>
            {userAccount?.email || "Guest"}
          </button>
          <nav className="hidden items-center gap-4 text-white/72 md:flex">
            <button onClick={() => setShowLibrary(true)}>Applications</button>
            {notifHistory.length > 0 && <button onClick={() => setShowNotifications(true)}>Notifications</button>}
            <button onClick={() => setShowWidgetSettings(true)}>Widgets</button>
            <button onClick={() => setShowCommand(true)}>Search</button>
          </nav>
        </div>

        <div className="flex items-center gap-3 text-white/75">
          <button className="hidden items-center gap-1 rounded-full bg-white/10 px-2 py-1 sm:flex" onClick={() => setShowCommand(true)}>
            <Command className="size-3" /> K
          </button>
          <button type="button" onClick={() => setShowCommand(true)} className="rounded-full p-1 transition hover:bg-white/10" aria-label="Open Spotlight Search" title="Search">
            <Search className="size-4" />
          </button>
          <Wifi className="size-4" />
          <Cloud className="size-4" />
          <span className="hidden sm:inline">{now ? formatDate(now) : "--"}</span>
          <span>{now ? formatTime(now) : "--:--"}</span>
        </div>
      </header>

      <section className="relative z-10 min-h-dvh px-6 pb-28 pt-14">
        {now && widgetVisibility.calendar && <CalendarWidget date={now} onClose={() => updateWidgetVisibility("calendar", false)} />}
        {isLoggedIn && (
          <DesktopMonitorBoard state={overview} visibility={widgetVisibility} order={widgetOrder} onAskDo={askDoFromWidget} />
        )}
      </section>

      <nav className="fixed bottom-3 left-1/2 z-30 flex max-w-[calc(100vw-12px)] -translate-x-1/2 items-end gap-1 overflow-x-auto rounded-3xl border border-white/18 bg-white/14 p-1.5 shadow-[0_24px_80px_rgba(0,0,0,.38)] backdrop-blur-2xl sm:bottom-5 sm:gap-2 sm:rounded-[28px] sm:p-2">
        <DockButton label="Launchpad" icon={MonitorDot} active={showLibrary} onClick={() => setShowLibrary((value) => !value)} />
        {modules.filter((module) => !module.disabled).map((module) => <DockButton key={module.name} label={module.name} icon={module.icon} active={previewModule?.name === module.name} onClick={() => setPreviewModule((current) => current?.name === module.name ? null : module)} />)}
        <DockButton label="Do" icon={Bot} active={showAssistant} onClick={() => setShowAssistant((value) => !value)} />
        <DockButton label="Apps" icon={Grid3X3} active={showLibrary} onClick={() => setShowLibrary((value) => !value)} />
        <div className="mx-0.5 h-7 w-px shrink-0 bg-white/18 sm:mx-1 sm:h-9" />
        {notifHistory.length > 0 && (
          <DockButton label={`Notifications (${notifHistory.length})`} icon={Bell} active={showNotifications} onClick={() => setShowNotifications((value) => !value)} />
        )}
        <DockButton label="Files" icon={Folder} active={showFiles} onClick={() => setShowFiles((value) => !value)} />
        <DockButton label="Settings" icon={Settings} active={showSettings} onClick={() => setShowSettings((value) => !value)} />
      </nav>

      {showAssistantShortcut && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[92px]">
          <div className="arkiv-assistant-shortcut-glow absolute bottom-[46px] h-36 w-[min(920px,calc(100vw-24px))] rounded-[48px] bg-gradient-to-r from-pink-400/26 via-orange-300/32 to-rose-400/26 blur-3xl" />
          <form
            ref={assistantShortcutRef}
            onSubmit={openAssistantFromShortcut}
            className="arkiv-assistant-shortcut-shell pointer-events-auto relative flex w-[min(720px,calc(100vw-32px))] items-center gap-3 rounded-[24px] border border-white/22 bg-white/12 px-4 py-3 shadow-[0_26px_90px_rgba(0,0,0,.48)] backdrop-blur-2xl focus-within:border-pink-200/55"
          >
            <div className={`grid size-9 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${pinkAccent}`}>
              <Bot className="size-5 text-white" />
            </div>
            <label className="relative flex min-w-0 flex-1 cursor-text items-center">
              <span className="pointer-events-none min-w-0 truncate text-[15px] font-medium text-white">
                {assistantShortcutInput || "What can I help you with today?"}
              </span>
              {assistantShortcutFocused && (
                <span className="ml-0.5 h-6 w-0.5 shrink-0 animate-pulse rounded-full bg-pink-300" />
              )}
              <input
                ref={assistantShortcutInputRef}
                value={assistantShortcutInput}
                onChange={(event) => setAssistantShortcutInput(event.target.value)}
                onFocus={() => setAssistantShortcutFocused(true)}
                onBlur={() => setAssistantShortcutFocused(false)}
                aria-label="Tanya Do"
                className="arkiv-assistant-shortcut-input absolute inset-0 h-full w-full cursor-text appearance-none border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none"
              />
            </label>
            <button
              type="button"
              className="hidden shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-white/55 transition hover:bg-white/8 sm:flex"
              onClick={() => {
                setQueuedAssistantPrompt(null);
                setShowAssistant(true);
              }}
            >
              New Chat
              <ChevronDown className="size-3.5" />
            </button>
            <button
              type="submit"
              disabled={!assistantShortcutInput.trim()}
              className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-pink-400 to-rose-600 text-white shadow-lg transition hover:from-pink-300 hover:to-rose-500 disabled:cursor-not-allowed disabled:opacity-45"
              title="Buka Do"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      )}

      {previewModule && <ModuleWindow module={previewModule} isLoggedIn={isLoggedIn} onClose={() => setPreviewModule(null)} onOpen={() => openModule(previewModule)} />}
      {showApplicationFolder && <ApplicationFolderModal onClose={() => setShowApplicationFolder(false)} onOpen={openModule} onComingSoon={setComingSoonApp} />} 
      {comingSoonApp && <ComingSoonModal title={comingSoonApp} onClose={() => setComingSoonApp(null)} />}
      {showLibrary && <AppLibrary onClose={() => setShowLibrary(false)} onOpen={openModule} />}
      {showCommand && (
        <CommandPalette
          query={query}
          setQuery={setQuery}
          modules={filteredModules}
          onClose={() => setShowCommand(false)}
          onOpen={openModule}
          onAssistant={() => setShowAssistant(true)}
          onNotifications={() => setShowNotifications(true)}
          onWallpaper={() => setShowWallpaperPicker(true)}
          onWidgets={() => setShowWidgetSettings(true)}
          onFiles={() => setShowFiles(true)}
          onSettings={() => setShowSettings(true)}
        />
      )}
      {showWaNotif && (
        <WindowShell title="Notifikasi WA" onClose={() => setShowWaNotif(false)} className="left-1/2 top-14 max-h-[calc(100vh-140px)] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-y-auto">
          <WaNotifSettingsPanel />
        </WindowShell>
      )}
      {showNotifications && notifHistory.length > 0 && (
        <NotificationCenter items={notifHistory} onOpen={openNotification} onClear={() => { setNotifHistory([]); setShowNotifications(false); }} onClose={() => setShowNotifications(false)} />
      )}
      <NotificationPopups popups={notifPopups} onDismiss={dismissPopup} onOpen={openNotification} />
      {showFiles && <FileExplorer onClose={() => setShowFiles(false)} isLoggedIn={isLoggedIn} />}
      {showWallpaperPicker && <WallpaperPicker selected={wallpaper.id} onSelect={(item) => { setWallpaper(item); window.localStorage.setItem("arkiv-wallpaper", item.id); }} onClose={() => setShowWallpaperPicker(false)} />}
      {showWidgetSettings && <WidgetSettings visibility={widgetVisibility} order={widgetOrder} onChange={updateWidgetVisibility} onMove={moveWidget} onClose={() => setShowWidgetSettings(false)} />}
      {showSettings && (
        <SystemSettings
          onOpenWaNotif={() => { setShowSettings(false); setShowWaNotif(true); }}
          soundEnabled={soundEnabled}
          assistantSettings={assistantSettings}
          onSoundChange={updateSoundEnabled}
          onAssistantSettingsChange={updateAssistantSettings}
          onOpenWallpaper={() => setShowWallpaperPicker(true)}
          onOpenWidgets={() => setShowWidgetSettings(true)}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showAbout && <AboutArkiv onClose={() => setShowAbout(false)} />}
      {showAssistant && (
        <AiAssistantWindow
          account={userAccount}
          settings={assistantSettings}
          initialPrompt={queuedAssistantPrompt}
          onInitialPromptConsumed={consumeQueuedAssistantPrompt}
          onClose={() => setShowAssistant(false)}
        />
      )}
      {openAppModule && <ApplicationWindow module={openAppModule} url={moduleHref(openAppModule)} onClose={() => setOpenAppModule(null)} />}
      {moduleOpenChoice && (
        <ModuleOpenChoiceModal
          module={moduleOpenChoice}
          isLoggedIn={isLoggedIn}
          onClose={() => setModuleOpenChoice(null)}
          onOpenInside={() => openModuleInArkivOs(moduleOpenChoice)}
          onOpenNewTab={() => openModuleInNewTab(moduleOpenChoice)}
        />
      )}
      {showAccount && (
        <OsAccountPopup
          account={userAccount}
          onClose={() => setShowAccount(false)}
          onLogin={() => router.push("/login?redirect=/arkiv-os")}
          onDashboard={() => router.push("/dashboard")}
        />
      )}
      {contextMenu?.module && <ContextMenu x={contextMenu.x} y={contextMenu.y} module={contextMenu.module} onOpen={() => openModule(contextMenu.module!)} onInfo={() => setPreviewModule(contextMenu.module!)} />}
      {contextMenu?.desktop && <DesktopContextMenu x={contextMenu.x} y={contextMenu.y} onWallpaper={() => setShowWallpaperPicker(true)} onWidgets={() => setShowWidgetSettings(true)} onApps={() => setShowLibrary(true)} onSettings={() => setShowSettings(true)} onAbout={() => setShowAbout(true)} />}
    </main>
  );
}

function CalendarWidget({ date, onClose }: { date: Date; onClose: () => void }) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = date.getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(date);
  const weekDays = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const cells = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  return (
    <WindowShell title="Calendar Widget" onClose={onClose} className="right-5 top-16 hidden w-80 lg:block">
      <div className="p-5">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight capitalize">{monthLabel}</h2>
            <p className="text-xs text-white/55">Monthly view</p>
          </div>
          <div className="rounded-2xl bg-pink-500/25 px-3 py-2 text-center">
            <div className="text-2xl font-bold leading-none">{today}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-pink-100">Today</div>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {weekDays.map((day) => (
            <div key={day} className="py-1 text-[11px] font-semibold text-white/45">
              {day}
            </div>
          ))}
          {cells.map((cell, index) => {
            const isToday = cell === today;
            return (
              <div
                key={`${cell ?? "blank"}-${index}`}
                className={`grid aspect-square place-items-center rounded-xl text-sm ${
                  cell ? (isToday ? "bg-pink-600 font-bold text-white shadow-lg shadow-pink-900/30" : "bg-black/14 text-white/78") : ""
                }`}
              >
                {cell}
              </div>
            );
          })}
        </div>
      </div>
    </WindowShell>
  );
}

function DockButton({ label, icon: Icon, onClick, active = false }: { label: string; icon: ComponentType<{ className?: string }>; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`group relative grid size-10 shrink-0 place-items-center rounded-xl border border-white/14 text-white shadow-lg transition duration-200 hover:-translate-y-3 hover:scale-125 hover:bg-white/24 sm:size-12 sm:rounded-2xl ${active ? "bg-white/24 ring-1 ring-pink-200/50" : "bg-white/14"}`}
    >
      <Icon className="size-4 transition group-hover:scale-110 sm:size-5" />
      {active && <span className="absolute -bottom-1 size-1.5 rounded-full bg-pink-200 shadow-[0_0_12px_rgba(244,114,182,.9)]" />}
    </button>
  );
}

let topWindowZ = 40;

function WindowShell({ title, children, onClose, className = "" }: { title: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [zIndex, setZIndex] = useState(40);

  const captureRect = () => {
    const box = windowRef.current?.getBoundingClientRect();
    if (!box) return null;
    const next = { left: box.left, top: box.top, width: box.width, height: box.height };
    setRect(next);
    return next;
  };

  const focusWindow = () => setZIndex(++topWindowZ);

  const startDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    focusWindow();
    if (maximized) return;
    const current = rect ?? captureRect();
    if (!current) return;
    dragRef.current = {
      offsetX: event.clientX - current.left,
      offsetY: event.clientY - current.top,
    };
    event.preventDefault();
  };

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      const resize = resizeRef.current;
      if (drag) {
        setRect((current) => {
          if (!current) return current;
          return {
            ...current,
            left: Math.max(8, Math.min(window.innerWidth - current.width - 8, event.clientX - drag.offsetX)),
            top: Math.max(44, Math.min(window.innerHeight - 56, event.clientY - drag.offsetY)),
          };
        });
      }
      if (resize) {
        setRect((current) => {
          if (!current) return current;
          return {
            ...current,
            width: Math.max(300, Math.min(window.innerWidth - current.left - 8, resize.width + event.clientX - resize.startX)),
            height: Math.max(180, Math.min(window.innerHeight - current.top - 72, resize.height + event.clientY - resize.startY)),
          };
        });
      }
    };
    const handleUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  const floatingStyle: CSSProperties | undefined = maximized
    ? { left: 16, top: 48, right: 16, bottom: 92, width: "auto", height: "auto" }
    : rect
      ? { left: rect.left, top: rect.top, width: rect.width, height: minimized ? "auto" : rect.height }
      : undefined;

  const activeClassName = maximized || rect ? "" : className;

  return (
    <div
      ref={windowRef}
      style={{ ...floatingStyle, zIndex }}
      onMouseDown={focusWindow}
      className={`fixed overflow-hidden rounded-3xl border bg-slate-950/55 shadow-2xl backdrop-blur-2xl max-sm:inset-x-2! max-sm:top-11! max-sm:bottom-[72px]! max-sm:h-auto! max-sm:max-h-none! max-sm:w-auto! max-sm:translate-x-0! max-sm:translate-y-0! max-sm:rounded-2xl! ${minimized ? "max-sm:bottom-auto!" : ""} ${zIndex === topWindowZ ? "border-pink-200/35 ring-1 ring-pink-300/20" : "border-white/18"} ${activeClassName}`}
    >
      <div className="flex h-11 cursor-move items-center justify-between border-b border-white/10 px-4" onMouseDown={startDrag}>
        <div className="flex items-center gap-2" onMouseDown={(event) => event.stopPropagation()}>
          <button className="size-3 rounded-full bg-red-400 transition hover:scale-125" onClick={onClose} aria-label="Close" title="Close" />
          <button
            className="size-3 rounded-full bg-amber-300 transition hover:scale-125"
            onClick={() => {
              if (!rect) captureRect();
              setMinimized((value) => !value);
              setMaximized(false);
            }}
            aria-label="Minimize"
            title="Minimize"
          />
          <button
            className="size-3 rounded-full bg-emerald-400 transition hover:scale-125"
            onClick={() => {
              if (!maximized && !rect) captureRect();
              setMinimized(false);
              setMaximized((value) => !value);
            }}
            aria-label="Maximize"
            title="Maximize"
          />
        </div>
        <span className="select-none text-xs font-medium text-white/65">{title}</span>
        <button onClick={onClose} onMouseDown={(event) => event.stopPropagation()}><X className="size-4 text-white/60" /></button>
      </div>
      {!minimized && <div className={maximized ? "h-[calc(100%-44px)] overflow-auto" : "h-[calc(100%-44px)] overflow-auto"}>{children}</div>}
      {!minimized && !maximized && (
        <button
          aria-label="Resize"
          title="Resize"
          className="absolute bottom-2 right-2 size-4 cursor-nwse-resize rounded-sm border-b-2 border-r-2 border-white/35"
          onMouseDown={(event) => {
            event.stopPropagation();
            focusWindow();
            const current = rect ?? captureRect();
            if (!current) return;
            resizeRef.current = { startX: event.clientX, startY: event.clientY, width: current.width, height: current.height };
          }}
        />
      )}
    </div>
  );
}

function ModuleWindow({ module, isLoggedIn, onClose, onOpen }: { module: DesktopModule; isLoggedIn: boolean; onClose: () => void; onOpen: () => void }) {
  const Icon = module.icon;
  return (
    <WindowShell title={`${module.name} Preview`} onClose={onClose} className="left-1/2 top-1/2 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2">
      <div className="p-6">
        <div className="mb-5 flex items-center gap-4">
          <div className="relative grid size-16 place-items-center rounded-[22px] border border-white/25 bg-white/15">
            <div className={`absolute inset-1 rounded-[18px] bg-gradient-to-br ${pinkAccent}`} />
            <Icon className="relative size-8 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{module.name}</h2>
            <p className="text-sm text-white/55">{module.subtitle}</p>
          </div>
        </div>
        <p className="text-sm leading-6 text-white/70">{module.description}</p>
        <div className="mt-6 flex items-center justify-between rounded-2xl bg-white/8 p-3 text-sm text-white/65">
          <span>Status</span>
          <span>{module.disabled ? "Coming soon" : isLoggedIn ? "Ready to open" : "Login required"}</span>
        </div>
        <button disabled={module.disabled} onClick={onOpen} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-50">
          <LogIn className="size-4" /> {isLoggedIn ? "Open Workspace" : "Login & Open"}
        </button>
      </div>
    </WindowShell>
  );
}

function ModuleOpenChoiceModal({
  module,
  isLoggedIn,
  onClose,
  onOpenInside,
  onOpenNewTab,
}: {
  module: DesktopModule;
  isLoggedIn: boolean;
  onClose: () => void;
  onOpenInside: () => void;
  onOpenNewTab: () => void;
}) {
  const Icon = module.icon;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-xl" onClick={onClose}>
      <div
        className="w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-[28px] border border-white/18 bg-slate-950/88 shadow-[0_28px_90px_rgba(0,0,0,.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-white/10 p-5">
          <div className="flex items-center gap-4">
            <div className="relative grid size-14 place-items-center rounded-2xl border border-white/25 bg-white/12">
              <div className={`absolute inset-1 rounded-[18px] bg-gradient-to-br ${pinkAccent}`} />
              <Icon className="relative size-7 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{module.name}</h2>
              <p className="text-xs text-white/50">{isLoggedIn ? module.subtitle : "Login required"}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/18 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <button
            type="button"
            onClick={onOpenInside}
            className="group flex w-full items-center gap-4 rounded-2xl border border-pink-300/30 bg-pink-500/16 p-4 text-left transition hover:border-pink-200/50 hover:bg-pink-500/24"
          >
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-pink-500 text-white shadow-lg shadow-pink-950/30">
              <MonitorDot className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white">Buka di Arkiv OS</div>
              <div className="mt-1 text-xs leading-5 text-white/55">Module tampil sebagai window di desktop Arkiv OS.</div>
            </div>
            <ChevronRight className="size-4 text-white/45 transition group-hover:translate-x-0.5 group-hover:text-white" />
          </button>

          <button
            type="button"
            onClick={onOpenNewTab}
            className="group flex w-full items-center gap-4 rounded-2xl border border-white/12 bg-white/8 p-4 text-left transition hover:border-white/24 hover:bg-white/12"
          >
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/12 text-white">
              <ExternalLink className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white">Open New Tab</div>
              <div className="mt-1 text-xs leading-5 text-white/55">Module dibuka di tab browser baru.</div>
            </div>
            <ChevronRight className="size-4 text-white/45 transition group-hover:translate-x-0.5 group-hover:text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CommandPalette({
  query,
  setQuery,
  modules,
  onClose,
  onOpen,
  onAssistant,
  onNotifications,
  onWallpaper,
  onWidgets,
  onFiles,
  onSettings,
}: {
  query: string;
  setQuery: (value: string) => void;
  modules: DesktopModule[];
  onClose: () => void;
  onOpen: (module: DesktopModule) => void;
  onAssistant: () => void;
  onNotifications: () => void;
  onWallpaper: () => void;
  onWidgets: () => void;
  onFiles: () => void;
  onSettings: () => void;
}) {
  const actions = [
    { label: "System Settings", subtitle: "Theme, widgets, sound, account", icon: Settings, run: onSettings },
    { label: "Arkiv Drive", subtitle: "Open file explorer", icon: Folder, run: onFiles },
    { label: "Tanya Do", subtitle: "Buka asisten Do", icon: Bot, run: onAssistant },
    { label: "Notification Center", subtitle: "Review alerts and approvals", icon: Bell, run: onNotifications },
    { label: "Widgets", subtitle: "Turn desktop widgets on or off", icon: Activity, run: onWidgets },
    { label: "Change Wallpaper", subtitle: "Open Desktop settings", icon: MonitorDot, run: onWallpaper },
  ].filter((action) => `${action.label} ${action.subtitle}`.toLowerCase().includes(query.trim().toLowerCase()) || !query.trim());

  const runAction = (run: () => void) => {
    run();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-auto mt-20 max-w-xl overflow-hidden rounded-3xl border border-white/18 bg-slate-950/80 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <Search className="size-5 text-white/50" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search modules, e.g. HRIS, POS..." className="w-full rounded-xl bg-white px-3 py-2 text-sm text-black outline-none placeholder:text-gray-600" />
          <kbd className="rounded-md bg-white/10 px-2 py-1 text-[10px] text-white/50">ESC</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {actions.length > 0 && <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Quick Actions</div>}
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button key={action.label} onClick={() => runAction(action.run)} className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-white/10">
                <span className="flex items-center gap-3"><Icon className="size-5 text-pink-200" /><span><span className="block text-sm font-medium">{action.label}</span><span className="text-xs text-white/45">{action.subtitle}</span></span></span>
                <ChevronRight className="size-4 text-white/35" />
              </button>
            );
          })}
          <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Applications</div>
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <button key={module.name} onClick={() => !module.disabled && runAction(() => onOpen(module))} className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-white/10 disabled:opacity-50" disabled={module.disabled}>
                <span className="flex items-center gap-3"><Icon className="size-5 text-pink-200" /><span><span className="block text-sm font-medium">{module.name}</span><span className="text-xs text-white/45">{module.subtitle}</span></span></span>
                <ChevronRight className="size-4 text-white/35" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AppLibrary({ onClose, onOpen }: { onClose: () => void; onOpen: (module: DesktopModule) => void }) {
  return (
    <WindowShell title="Applications" onClose={onClose} className="left-1/2 top-20 w-[min(620px,calc(100vw-32px))] -translate-x-1/2">
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
        {modules.map((module) => {
          const Icon = module.icon;
          return (
            <button key={module.name} disabled={module.disabled} onClick={() => onOpen(module)} className="rounded-3xl bg-white/8 p-4 text-center transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-60">
              <div className={`mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-gradient-to-br ${pinkAccent}`}><Icon className="size-7" /></div>
              <div className="text-sm font-medium">{module.name}</div>
              <div className="text-[11px] text-white/45">{module.subtitle}</div>
            </button>
          );
        })}
      </div>
    </WindowShell>
  );
}

function ApplicationFolderModal({ onClose, onOpen, onComingSoon }: { onClose: () => void; onOpen: (module: DesktopModule) => void; onComingSoon: (name: string) => void }) {
  const activeModules = modules.filter((m) => !m.disabled);
  const comingSoonApps = [
    { name: "Finance", subtitle: "Accounting & Budget", icon: WalletCards },
    { name: "Legal", subtitle: "Contract & Compliance", icon: Scale },
    { name: "HAKI", subtitle: "IP Rights", icon: Landmark },
    { name: "Business", subtitle: "Planning & Strategy", icon: Building2 },
  ];
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop dengan blur */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-3xl" />
      
      {/* Modal Window - macOS Liquid Glass Style */}
      <div 
        className="relative z-10 w-[min(680px,calc(100vw-48px))] overflow-hidden rounded-3xl bg-gradient-to-br from-white/10 to-white/5 p-6 shadow-2xl backdrop-blur-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Module Grid - macOS Launchpad style - Liquid Glass */}
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
          {activeModules.map((module) => {
            const Icon = module.icon;
            return (
              <button
                key={module.name}
                onClick={() => {
                  onOpen(module);
                  onClose();
                }}
                className="group flex flex-col items-center gap-3 rounded-3xl p-4 transition-all duration-200 hover:bg-white/10 hover:shadow-xl hover:shadow-pink-500/20"
              >
                {/* Icon dengan shadow dan gradient */}
                <div className="relative grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-pink-400 via-pink-500 to-rose-600 shadow-lg transition-all duration-200 group-hover:scale-110 group-hover:shadow-2xl group-hover:shadow-pink-500/40">
                  <Icon className="size-8 text-white drop-shadow-lg" />
                </div>
                
                {/* Label */}
                <div className="text-center">
                  <div className="text-sm font-medium text-white">{module.name}</div>
                  <div className="mt-1 text-[11px] text-white/60">{module.subtitle}</div>
                </div>
              </button>
            );
          })}
          {comingSoonApps.map((app) => {
            const Icon = app.icon;
            return (
              <button
                key={app.name}
                onClick={() => {
                  onComingSoon(app.name);
                  onClose();
                }}
                className="group flex flex-col items-center gap-3 rounded-3xl p-4 transition-all duration-200 hover:bg-white/10 hover:shadow-xl hover:shadow-pink-500/20"
              >
                <div className="relative grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-pink-400 via-pink-500 to-rose-600 shadow-lg transition-all duration-200 group-hover:scale-110 group-hover:shadow-2xl group-hover:shadow-pink-500/40">
                  <Icon className="size-8 text-white drop-shadow-lg" />
                  <span className="absolute -right-1 -top-1 rounded-full border border-white/40 bg-amber-300 px-1.5 py-0.5 text-[9px] font-bold text-slate-950">Soon</span>
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium text-white">{app.name}</div>
                  <div className="mt-1 text-[11px] text-white/60">{app.subtitle}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ComingSoonModal({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <WindowShell title="Coming Soon" onClose={onClose} className="right-5 top-14 w-[min(390px,calc(100vw-32px))]">
      <div className="space-y-3 p-4">
        <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-white/45">Application module</div>
            </div>
            <span className="rounded-full bg-pink-500/20 px-3 py-1 text-xs font-semibold text-pink-100">Coming Soon</span>
          </div>
        </div>
        <div className="block w-full rounded-3xl border border-white/10 bg-white/8 p-3 text-left text-sm text-white/72">
          <div className="flex gap-3">
            <div className="mt-0.5 size-2.5 rounded-full bg-pink-300" />
            <div>
              <div>Module {title} sedang disiapkan dan akan tersedia pada update berikutnya.</div>
              <div className="mt-1 text-xs text-white/40">Arkiv OS · Coming Soon</div>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="w-full rounded-2xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-pink-500">
          Tutup
        </button>
      </div>
    </WindowShell>
  );
}

function IntegrationSettingsNative() {
  const folders = [
    { label: "Game", icon: Gamepad2, active: true },
    { label: "Photobox", icon: Camera },
    { label: "Payment Gateway", icon: CreditCard },
    { label: "API & Webhook", icon: Plug },
    { label: "Security", icon: ShieldCheck },
    { label: "Keys & Tokens", icon: Command },
  ];

  const integrations = [
    { name: "Game", note: "Arcade machine, topup credit, game session, dan status device", icon: Gamepad2, status: "Not connected" },
    { name: "Photobox", note: "Booking, payment, print queue, dan laporan penjualan photobox", icon: Camera, status: "Not connected" },
    { name: "Payment Gateway", note: "QRIS, kartu kredit, settlement, virtual account, dan webhook", icon: CreditCard, status: "Draft" },
    { name: "API & Webhook", note: "Endpoint callback, event subscription, dan automation trigger", icon: Plug, status: "Draft" },
  ];

  const settings = [
    "Auto Sync · Off",
    "Realtime Events · Off",
    "Webhook Security · Enabled",
    "Sandbox Server · Enabled",
  ];

  return (
    <div className="flex h-full min-h-[420px]">
      <aside className="w-56 border-r border-white/10 bg-black/12 p-3">
        <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Integration</div>
        {folders.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              className={`mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition hover:bg-white/10 ${item.active ? "bg-white/14 text-white" : "text-white/65"}`}
            >
              <Icon className="size-4 text-pink-200" /> {item.label}
            </button>
          );
        })}
        <div className="mt-5 rounded-3xl border border-white/10 bg-white/8 p-3 text-xs leading-5 text-white/50">
          Native Arkiv OS settings untuk koneksi Game, Photobox, Payment Gateway, API, dan webhook.
        </div>
      </aside>

      <section className="min-w-0 flex-1 p-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Integration Center</h2>
            <p className="text-xs text-white/45">Arkiv OS · native settings</p>
          </div>
          <button className="rounded-2xl border border-white/10 bg-white/8 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/12">Add Integration</button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {integrations.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.name} className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4 text-left transition hover:bg-white/12">
                <div className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br ${pinkAccent}`}><Icon className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{item.name}</div>
                  <div className="mt-1 text-xs text-white/45">{item.note}</div>
                </div>
                <div className="hidden rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/45 lg:block">{item.status}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-3xl border border-white/10 bg-white/8 p-4 text-sm leading-6 text-white/55">
          <div className="mb-3 text-sm font-semibold text-white">System Settings</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {settings.map((setting) => (
              <div key={setting} className="rounded-2xl bg-black/12 px-3 py-2 text-xs text-white/55">{setting}</div>
            ))}
          </div>
          <div className="mt-4 text-xs leading-5 text-white/45">
            Next phase: connect real credentials, sandbox/production endpoints, device status monitoring, and webhook logs.
          </div>
        </div>
      </section>
    </div>
  );
}

function ApplicationWindow({ module, url, onClose }: { module: DesktopModule; url: string; onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const isNativeIntegration = module.name === "Integration";

  return (
    <WindowShell title={module.name} onClose={onClose} className="left-1/2 top-16 h-[min(700px,calc(100vh-120px))] w-[min(1200px,calc(100vw-32px))] -translate-x-1/2">
      <div className="flex h-full flex-col">
        {isNativeIntegration ? (
          <IntegrationSettingsNative />
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="rounded-full bg-red-500/10 p-4">
              <AlertCircle className="size-8 text-red-500" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900">Failed to load</h3>
              <p className="text-sm text-gray-500">Unable to load the application</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl bg-pink-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-pink-500"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Loading Overlay */}
            {isLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
                <div className="mb-4 grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-pink-400 via-pink-500 to-rose-600 shadow-xl">
                  <Loader2 className="size-8 animate-spin text-white" />
                </div>
                <p className="text-sm font-medium text-gray-600">Loading {module.name}...</p>
              </div>
            )}

            {/* Iframe Content */}
            <iframe
              src={url}
              className="h-full w-full bg-white"
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setError(true);
                setIsLoading(false);
              }}
              title={module.name}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </>
        )}
      </div>
    </WindowShell>
  );
}

const driveFolders = [
  {
    name: "HRIS",
    files: ["Employee master data.xlsx", "Payroll summary.pdf", "KPI review export.csv", "Candidate CV archive.zip"],
  },
  {
    name: "Procurement",
    files: ["Purchase request report.pdf", "PO pending approval.xlsx", "Supplier price list.csv", "GRN quality control.pdf"],
  },
  {
    name: "POS",
    files: ["Daily sales report.pdf", "Product catalog.xlsx", "Reservation export.csv", "Customer topup log.pdf"],
  },
  {
    name: "Reports",
    files: ["Executive dashboard snapshot.pdf", "Inventory valuation.xlsx", "AI assistant summaries.md"],
  },
];

function FileExplorer({ onClose, isLoggedIn }: { onClose: () => void; isLoggedIn: boolean }) {
  const [activeFolder, setActiveFolder] = useState(driveFolders[0].name);
  const folder = driveFolders.find((item) => item.name === activeFolder) ?? driveFolders[0];

  return (
    <WindowShell title="Arkiv Drive" onClose={onClose} className="left-1/2 top-16 h-[min(620px,calc(100vh-120px))] w-[min(860px,calc(100vw-32px))] -translate-x-1/2">
      <div className="flex h-full min-h-[420px]">
        <aside className="w-56 border-r border-white/10 bg-black/12 p-3">
          <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Locations</div>
          {driveFolders.map((item) => (
            <button key={item.name} onClick={() => setActiveFolder(item.name)} className={`mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition hover:bg-white/10 ${activeFolder === item.name ? "bg-white/14 text-white" : "text-white/65"}`}>
              <Folder className="size-4 text-pink-200" /> {item.name}
            </button>
          ))}
          <div className="mt-5 rounded-3xl border border-white/10 bg-white/8 p-3 text-xs leading-5 text-white/50">
            {isLoggedIn ? "Connected to Arkiv workspace." : "Login required to open or download real files."}
          </div>
        </aside>
        <section className="min-w-0 flex-1 p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{folder.name}</h2>
              <p className="text-xs text-white/45">Arkiv Drive · preview explorer</p>
            </div>
            <button className="rounded-2xl border border-white/10 bg-white/8 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/12">New Folder</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {folder.files.map((file) => (
              <button key={file} className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4 text-left transition hover:bg-white/12">
                <div className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br ${pinkAccent}`}><Folder className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{file}</div>
                  <div className="mt-1 text-xs text-white/45">Modified today · Preview</div>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-5 rounded-3xl border border-white/10 bg-white/8 p-4 text-sm leading-6 text-white/55">
            Next phase: connect this explorer to object storage / generated module exports for real download, preview, and permissions.
          </div>
        </section>
      </div>
    </WindowShell>
  );
}

function NotificationCenter({
  items,
  onOpen,
  onClear,
  onClose,
}: {
  items: ActivityNotification[];
  onOpen: (n: ActivityNotification) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <WindowShell title="Notification Center" onClose={onClose} className="right-5 top-14 w-[min(390px,calc(100vw-32px))]">
      <div className="space-y-3 p-4">
        <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Aktivitas</div>
              <div className="text-xs text-white/45">Kejadian terbaru di bisnis Anda</div>
            </div>
            <button
              onClick={onClear}
              className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/60 transition hover:bg-white/16 hover:text-white"
            >
              Bersihkan
            </button>
          </div>
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => onOpen(n)}
              className="block w-full rounded-3xl border border-white/10 bg-white/8 p-3 text-left text-sm text-white/72 transition hover:bg-white/12"
            >
              <div>{n.text}</div>
              <div className="mt-1 text-xs text-white/40">
                {new Date(n.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} · klik untuk membuka
              </div>
            </button>
          ))}
        </div>
      </div>
    </WindowShell>
  );
}

function AiAssistantWindow({
  account,
  settings,
  initialPrompt,
  onInitialPromptConsumed,
  onClose,
}: {
  account: OsUserAccount | null;
  settings: AiAssistantSettings;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
  onClose: () => void;
}) {
  /** Usulan aksi tulis Do yang menunggu tombol konfirmasi (EPIC-017 Fase E). */
  type PendingAction = {
    id: string;
    name: string;
    summary: string;
    status: "pending" | "confirmed" | "cancelled" | "expired" | "failed";
    result_note?: string;
  };
  type AssistantMessage = {
    role: "user" | "assistant";
    content: string;
    meta?: { status?: string; model?: string; scope?: string; fallbackReason?: string; pending_action?: PendingAction };
  };

  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<"ready" | "live" | "fallback">("ready");
  const [statusNote, setStatusNote] = useState("Do siap. Kirim pesan untuk mulai.");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; updated_at: string }>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [view, setView] = useState<"landing" | "chat">("landing");
  const messageListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  /** id aksi yang sedang diproses endpoint konfirmasi (disable tombol kartu). */
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  type Attachment = { name: string; text: string; method: string; truncated: boolean; chars: number };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Auto-scroll hanya saat user memang sedang di dasar percakapan; kalau ia
   *  menggulir ke atas untuk membaca jawaban lama, jangan disentak turun. */
  const stickToBottomRef = useRef(true);
  const skipSessionRestoreRef = useRef(Boolean(initialPrompt?.trim()));
  const initialPromptSentRef = useRef(false);
  const isAllowed = account?.role === "super_admin";
  const activeScope = AI_ASSISTANT_SCOPES.find((item) => item.id === settings.scope) ?? AI_ASSISTANT_SCOPES[0];
  const activeModel = AI_ASSISTANT_MODELS.find((item) => item.id === settings.model) ?? AI_ASSISTANT_MODELS[0];

  const refreshSessions = useCallback(() => {
    fetch("/api/ai/assistant?list=true")
      .then((r) => r.json())
      .then((data) => setSessions(data.sessions ?? []))
      .catch(() => {});
  }, []);

  const applyAssistantMeta = useCallback((meta?: AssistantMessage["meta"]) => {
    if (meta?.status === "live" && meta.model === activeModel.id) {
      setAssistantStatus("live");
      setStatusNote(`Live: ${activeModel.label}`);
      return;
    }

    setAssistantStatus("ready");
    setStatusNote(`Do siap · ${activeModel.label}`);
  }, [activeModel.id]);

  // On mount: fetch sessions + restore active session if any
  useEffect(() => {
    if (!isAllowed) return;
    refreshSessions();

    if (skipSessionRestoreRef.current) {
      return;
    }

    const saved = typeof window !== "undefined" ? localStorage.getItem("arkiv-ai-session") : null;
    if (saved) {
      setSessionId(saved);
      fetch(`/api/ai/assistant?session_id=${saved}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.messages?.length) {
            const mapped = data.messages
              .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
              .map((m: AssistantMessage) => ({ role: m.role, content: m.content, meta: m.meta }));
            setMessages(mapped);
            applyAssistantMeta(mapped.filter((m: AssistantMessage) => m.role === "assistant").at(-1)?.meta);
            setView("chat");
          }
        })
        .catch(() => {});
    }
  }, [applyAssistantMeta, isAllowed, refreshSessions]);

  useEffect(() => {
    if (assistantStatus === "ready") {
      setStatusNote(`Do siap · ${activeModel.label}`);
    }
  }, [activeModel.id, assistantStatus]);

  const enterLanding = () => {
    setView("landing");
    refreshSessions();
  };

  const startNewChat = () => {
    setSessionId(null);
    setMessages([
      {
        role: "assistant",
        content: `Halo, saya Do. Mode aktif: ${activeScope.label}. Tingkat: ${activeModel.label}.`,
      },
    ]);
    setAssistantStatus("ready");
    setStatusNote(`Do siap · ${activeModel.label}`);
    setView("chat");
    if (typeof window !== "undefined") localStorage.removeItem("arkiv-ai-session");
  };

  const loadSession = async (id: string) => {
    setSessionId(id);
    if (typeof window !== "undefined") localStorage.setItem("arkiv-ai-session", id);
    const res = await fetch(`/api/ai/assistant?session_id=${id}`);
    const data = await res.json();
    if (data.messages?.length) {
      const mapped = data.messages
        .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
        .map((m: AssistantMessage) => ({ role: m.role, content: m.content, meta: m.meta }));
      setMessages(mapped);
      applyAssistantMeta(mapped.filter((m: AssistantMessage) => m.role === "assistant").at(-1)?.meta);
    } else {
      setMessages([]);
      setAssistantStatus("ready");
      setStatusNote("Do siap. Kirim pesan untuk mulai.");
    }
    setView("chat");
  };

  const renameSession = async (id: string, currentTitle: string) => {
    if (typeof window === "undefined") return;
    const next = window.prompt("Judul baru untuk chat ini:", currentTitle || "");
    if (next === null) return;
    const title = next.trim();
    if (!title || title === currentTitle) return;

    // Optimistic: judul langsung berubah di daftar, dikembalikan bila gagal.
    const before = sessions;
    setSessions((prev) => prev.map((item) => (item.id === id ? { ...item, title } : item)));
    try {
      const response = await fetch(`/api/ai/assistant?session_id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error("gagal");
    } catch {
      setSessions(before);
    }
  };

  const deleteSession = async (id: string) => {
    const confirmed = typeof window === "undefined" || window.confirm("Hapus session chat ini?");
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/ai/assistant?session_id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error || "Gagal menghapus session");

      setSessions((prev) => prev.filter((session) => session.id !== id));
      if (sessionId === id) {
        setSessionId(null);
        setMessages([]);
        setAssistantStatus("ready");
        setStatusNote(`Do siap · ${activeModel.label}`);
        setView("landing");
        if (typeof window !== "undefined") localStorage.removeItem("arkiv-ai-session");
      }
    } catch (error) {
      setStatusNote(error instanceof Error ? error.message : "Gagal menghapus session");
    }
  };

  const sendMessage = useCallback(async (text = input) => {
    const message = text.trim();
    if (!message || loading) return;

    // User baru saja menekan Enter: apa pun posisi scroll-nya, tarik ke bawah.
    stickToBottomRef.current = true;
    // Lampiran ikut pesan ini saja, lalu dikosongkan — pertanyaan berikutnya
    // tidak diam-diam membawa dokumen lama.
    const attachmentsToSend = attachments;
    const label = attachmentsToSend.length
      ? `${message}\n\n[Lampiran: ${attachmentsToSend.map((a) => a.name).join(", ")}]`
      : message;
    setMessages((prev) => [...prev, { role: "user", content: label }]);
    setInput("");
    setAttachments([]);
    setUploadError(null);
    setLoading(true);

    try {
      const history = messages
        .filter((item) => item.role === "user" || item.role === "assistant")
        .slice(-8);
      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history,
          session_id: sessionId,
          model: settings.model,
          scope: settings.scope,
          stream: true,
          attachments: attachmentsToSend.map((item) => ({ name: item.name, text: item.text })),
        }),
      });

      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(failure.error || "Do gagal merespons");
      }

      const applyResult = (payload: { session_id?: string; answer?: string; meta?: AssistantMessage["meta"] }) => {
        if (payload.session_id) {
          setSessionId(payload.session_id);
          if (typeof window !== "undefined") localStorage.setItem("arkiv-ai-session", payload.session_id);
        }
        const live = payload.meta?.status === "live";
        setAssistantStatus(live ? "live" : "fallback");
        setStatusNote(live ? `Live: ${activeModel.label}` : payload.meta?.fallbackReason ?? "Fallback aktif");
      };

      const isStream = response.headers.get("content-type")?.includes("text/event-stream");

      if (!isStream || !response.body) {
        // Server menjawab sekali-jadi (mis. jalur lama atau proxy menolak SSE).
        const json = await response.json();
        applyResult(json);
        setMessages((prev) => [...prev, { role: "assistant", content: json.answer, meta: json.meta }]);
        refreshSessions();
        return;
      }

      // Placeholder kosong yang isinya tumbuh seiring token berdatangan.
      let streamed = "";
      let placeholderAdded = false;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const pushDelta = (piece: string) => {
        streamed += piece;
        setMessages((prev) => {
          const next = [...prev];
          if (!placeholderAdded) {
            placeholderAdded = true;
            next.push({ role: "assistant", content: streamed });
            return next;
          }
          next[next.length - 1] = { ...next[next.length - 1], content: streamed };
          return next;
        });
        // Token pertama sudah tiba: sembunyikan indikator "Memproses...".
        setLoading(false);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = splitSseEvents(buffer);
        buffer = rest;

        for (const event of events) {
          for (const raw of extractSseData(event)) {
            let payload: { type?: string; text?: string; answer?: string; error?: string; session_id?: string; meta?: AssistantMessage["meta"] };
            try {
              payload = JSON.parse(raw);
            } catch {
              continue;
            }
            if (payload.type === "delta" && payload.text) {
              pushDelta(payload.text);
            } else if (payload.type === "done") {
              applyResult(payload);
              // Teks final dari server dipakai apa adanya — hasil rakitan klien
              // bisa berbeda bila ada event yang terlewat.
              setMessages((prev) => {
                const next = [...prev];
                const finalMessage = { role: "assistant" as const, content: payload.answer ?? streamed, meta: payload.meta };
                if (placeholderAdded) next[next.length - 1] = finalMessage;
                else next.push(finalMessage);
                return next;
              });
              placeholderAdded = true;
            } else if (payload.type === "error") {
              throw new Error(payload.error || "Do gagal merespons");
            }
          }
        }
      }

      refreshSessions();
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: error instanceof Error ? error.message : "Terjadi kesalahan." },
      ]);
    } finally {
      setLoading(false);
    }
  }, [attachments, input, loading, messages, refreshSessions, sessionId, settings.model, settings.scope]);

  /**
   * Keputusan user atas usulan aksi tulis. Eksekusi nyata terjadi di server
   * (endpoint konfirmasi memverifikasi kepemilikan, status pending, dan TTL) —
   * klik ganda atau kartu basi hanya menghasilkan pesan status, bukan aksi ganda.
   */
  const decideAction = useCallback(
    async (messageIndex: number, actionId: string, decision: "confirm" | "cancel") => {
      setActionBusyId(actionId);
      try {
        const res = await fetch("/api/ai/assistant/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action_id: actionId, decision }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          action?: { status?: PendingAction["status"] };
          message?: string;
          error?: string;
        };
        const status = json.action?.status ?? "failed";
        const note = json.message ?? json.error ?? (res.ok ? "" : "Gagal memproses aksi");
        setMessages((prev) =>
          prev.map((m, i) => {
            if (i !== messageIndex || !m.meta?.pending_action) return m;
            return {
              ...m,
              meta: { ...m.meta, pending_action: { ...m.meta.pending_action, status, result_note: note } },
            };
          })
        );
      } catch {
        // Jaringan putus: biarkan tetap pending supaya user bisa mencoba lagi.
        setMessages((prev) =>
          prev.map((m, i) => {
            if (i !== messageIndex || !m.meta?.pending_action) return m;
            return {
              ...m,
              meta: {
                ...m.meta,
                pending_action: { ...m.meta.pending_action, result_note: "Jaringan bermasalah, coba lagi." },
              },
            };
          })
        );
      } finally {
        setActionBusyId(null);
      }
    },
    []
  );

  // Tinggi textarea mengikuti jumlah baris; direset dulu agar bisa mengecil lagi
  // saat teks dihapus.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const handleAttach = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files).slice(0, 5)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/ai/assistant/attachment", { method: "POST", body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Gagal membaca ${file.name}`);
        setAttachments((prev) => [...prev.slice(-4), json.data as Attachment]);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Gagal membaca lampiran");
    } finally {
      setUploading(false);
      // Reset input supaya file yang sama bisa dipilih lagi setelah dihapus.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const copyMessage = useCallback(async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((current) => (current === index ? null : current)), 1800);
    } catch {
      // clipboard diblokir (mis. konteks non-HTTPS) — diamkan, tombol tetap ada
    }
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = messageListRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleMessageListScroll = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }, []);

  // Pesan baru & indikator "Memproses..." sama-sama menambah tinggi konten,
  // jadi keduanya perlu memicu scroll.
  useEffect(() => {
    if (view !== "chat") return;
    if (!stickToBottomRef.current) return;
    const id = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(id);
  }, [messages, loading, view, scrollToBottom]);

  // Masuk ke sebuah chat: langsung tampilkan bagian terbawah tanpa animasi.
  useEffect(() => {
    if (view !== "chat") return;
    stickToBottomRef.current = true;
    const id = requestAnimationFrame(() => scrollToBottom("auto"));
    return () => cancelAnimationFrame(id);
  }, [view, sessionId, scrollToBottom]);

  /** Buang jawaban terakhir lalu kirim ulang pertanyaan yang sama. */
  const regenerateLastAnswer = useCallback(() => {
    if (loading) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // Jawaban lama dibuang dari state supaya tidak ada dua jawaban berdampingan;
    // riwayat di server tetap utuh sebagai jejak.
    setMessages((prev) => {
      const next = [...prev];
      while (next.length && next[next.length - 1].role === "assistant") next.pop();
      return next.filter((m) => m !== lastUser);
    });
    sendMessage(lastUser.content);
  }, [loading, messages, sendMessage]);

  useEffect(() => {
    const message = initialPrompt?.trim();
    if (!message) return;
    if (initialPromptSentRef.current) return;
    initialPromptSentRef.current = true;
    skipSessionRestoreRef.current = true;
    onInitialPromptConsumed?.();

    if (!isAllowed) {
      return;
    }

    setView("chat");
    void sendMessage(message);
  }, [initialPrompt, isAllowed, onInitialPromptConsumed, sendMessage]);

  return (
    <WindowShell title="Do" onClose={onClose} className="right-5 top-14 flex h-[min(760px,calc(100vh-86px))] w-[min(780px,calc(100vw-32px))] flex-col">
      <div className="flex h-full overflow-hidden">
        {/* Sidebar: Chat history */}
        {showHistory && (
          <div className="flex w-56 flex-col border-r border-white/10 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Chat History</span>
              <button onClick={startNewChat} className="grid size-6 place-items-center rounded-lg bg-white/10 text-white/70 hover:bg-white/20" title="New chat">
                <Plus className="size-4" />
              </button>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`group flex w-full items-center rounded-xl text-xs transition ${sessionId === s.id ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10"}`}
                >
                  <button
                    onClick={() => { setShowHistory(false); loadSession(s.id); }}
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquareMore className="size-3.5 shrink-0" />
                      <span className="truncate">{s.title || "Chat session"}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-white/35">
                      {new Date(s.updated_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                    </div>
                  </button>
                  <button
                    onClick={() => renameSession(s.id, s.title)}
                    className="grid size-7 shrink-0 place-items-center rounded-lg text-white/35 transition hover:bg-white/12 hover:text-white/80"
                    title="Ganti nama session"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => deleteSession(s.id)}
                    className="mr-1 grid size-7 shrink-0 place-items-center rounded-lg text-white/35 transition hover:bg-rose-500/16 hover:text-rose-200"
                    title="Hapus session"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              {sessions.length === 0 && (
                <div className="px-2 py-4 text-center text-[10px] text-white/30">Belum ada riwayat chat</div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-white/10 p-3">
            <div className="flex items-center gap-3">
              <div className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br ${pinkAccent}`}>
                <Bot className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Do</div>
                <div className="truncate text-xs text-white/50">
                  {isAllowed ? `${activeScope.label} · ${activeModel.label}` : account ? "Only super_admin can use this assistant" : "Login as super_admin required"}
                </div>
              </div>
              {view === "chat" && (
                <button
                  onClick={enterLanding}
                  className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/55 transition hover:bg-white/15"
                  title="Kembali ke daftar session"
                >
                  <ChevronLeft className="size-3" />
                  Sessions
                </button>
              )}
              <button
                onClick={() => setShowHistory((v) => !v)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${showHistory ? "bg-pink-600 text-white" : "bg-white/10 text-white/55 hover:bg-white/15"}`}
                title="Toggle history sidebar"
              >
                <History className="mr-1 inline size-3" />
                History
              </button>
              <div className={`rounded-full px-3 py-1 text-xs font-semibold ${assistantStatus === "live" ? "bg-emerald-400/15 text-emerald-200" : assistantStatus === "fallback" ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-white/55"}`} title={statusNote}>
                {assistantStatus === "live" ? "Do Live" : assistantStatus === "fallback" ? "Fallback" : "Ready"}
              </div>
            </div>
          </div>

          {!isAllowed ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <Bot className="mb-4 size-12 text-pink-200" />
              <h3 className="text-lg font-semibold">Akses dibatasi</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">Do hanya bisa digunakan setelah login sebagai akun super_admin.</p>
              <Link href="/login?redirect=/arkiv-os" className="mt-5 rounded-2xl bg-pink-600 px-5 py-3 text-sm font-semibold hover:bg-pink-500">
                Login Super User
              </Link>
            </div>
          ) : view === "landing" ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-5 grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-pink-300 via-pink-500 to-rose-600 shadow-xl">
                <Bot className="size-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white/90">Do</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-white/55">
                Asisten cerdas untuk super_admin. Mode {activeScope.label} memakai {activeModel.label}.
              </p>
              <button
                onClick={startNewChat}
                className="mt-6 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-pink-700 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-pink-400 hover:to-pink-600"
              >
                <Plus className="size-4" />
                Start New Chat
              </button>

              {sessions.length > 0 && (
                <div className="mt-8 w-full max-w-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-white/40">Previous Sessions</span>
                  </div>
                  <div className="space-y-1">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className="flex w-full items-center rounded-xl bg-white/5 text-left text-xs text-white/60 transition hover:bg-white/10"
                      >
                        <button
                          onClick={() => loadSession(s.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
                        >
                          <MessageSquareMore className="size-3.5 shrink-0 text-white/40" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{s.title || "Chat session"}</div>
                            <div className="mt-0.5 text-[10px] text-white/30">
                              {new Date(s.updated_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} · {new Date(s.updated_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                          <ChevronRight className="size-3 text-white/30" />
                        </button>
                        <button
                          onClick={() => renameSession(s.id, s.title)}
                          className="grid size-8 shrink-0 place-items-center rounded-lg text-white/35 transition hover:bg-white/12 hover:text-white/80"
                          title="Ganti nama session"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => deleteSession(s.id)}
                          className="mr-2 grid size-8 shrink-0 place-items-center rounded-lg text-white/35 transition hover:bg-rose-500/16 hover:text-rose-200"
                          title="Hapus session"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sessions.length === 0 && (
                <p className="mt-4 text-xs text-white/30">No previous sessions found. Start a new chat above.</p>
              )}
            </div>
          ) : (
            <>
              <div
                ref={messageListRef}
                onScroll={handleMessageListScroll}
                className="flex-1 space-y-3 overflow-y-auto p-4"
              >
                {messages.map((message, index) => {
                  const isAssistant = message.role === "assistant";
                  // Regenerate hanya untuk jawaban terakhir: mengulang jawaban di
                  // tengah percakapan akan membuat sisa riwayat tidak nyambung.
                  const canRegenerate = isAssistant && index === messages.length - 1 && !loading;
                  return (
                    <div key={index} className={`group flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
                      <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm font-normal leading-6 ${message.role === "user" ? "bg-pink-600 text-white" : "bg-white/10 text-white/78"}`}>
                        {formatPlainChatText(message.content)}
                      </div>
                      {isAssistant && message.meta?.pending_action && (
                        <div className="mt-2 max-w-[85%] rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">
                            <ShieldCheck className="size-3.5" /> Konfirmasi aksi
                          </div>
                          <p className="mt-1.5 leading-6 text-white/80">{message.meta.pending_action.summary}</p>
                          {message.meta.pending_action.status === "pending" ? (
                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={actionBusyId === message.meta.pending_action.id}
                                onClick={() => decideAction(index, message.meta!.pending_action!.id, "confirm")}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-pink-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-pink-500 disabled:opacity-50"
                              >
                                {actionBusyId === message.meta.pending_action.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Check className="size-3.5" />
                                )}
                                Jalankan aksi
                              </button>
                              <button
                                type="button"
                                disabled={actionBusyId === message.meta.pending_action.id}
                                onClick={() => decideAction(index, message.meta!.pending_action!.id, "cancel")}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-[12px] text-white/70 transition hover:bg-white/15 disabled:opacity-50"
                              >
                                <X className="size-3.5" /> Batalkan
                              </button>
                              {message.meta.pending_action.result_note && (
                                <span className="text-[11px] text-amber-200/80">{message.meta.pending_action.result_note}</span>
                              )}
                            </div>
                          ) : (
                            <p className="mt-2 text-[12px] text-white/60">
                              {message.meta.pending_action.result_note ||
                                (message.meta.pending_action.status === "confirmed"
                                  ? "Aksi sudah dijalankan."
                                  : message.meta.pending_action.status === "cancelled"
                                    ? "Aksi dibatalkan."
                                    : message.meta.pending_action.status === "expired"
                                      ? "Aksi kedaluwarsa tanpa dikonfirmasi."
                                      : "Aksi gagal dijalankan.")}
                            </p>
                          )}
                        </div>
                      )}
                      {isAssistant && (
                        <div className="mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => copyMessage(message.content, index)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/45 transition hover:bg-white/10 hover:text-white/80"
                            title="Salin jawaban"
                          >
                            {copiedIndex === index ? <Check className="size-3" /> : <Copy className="size-3" />}
                            {copiedIndex === index ? "Tersalin" : "Salin"}
                          </button>
                          {canRegenerate && (
                            <button
                              type="button"
                              onClick={regenerateLastAnswer}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/45 transition hover:bg-white/10 hover:text-white/80"
                              title="Minta jawaban ulang"
                            >
                              <RefreshCw className="size-3" /> Ulangi
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {loading && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/70">
                      <Loader2 className="size-4 animate-spin" /> Memproses...
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="truncate rounded-xl border border-white/10 bg-white/8 px-2.5 py-1.5 text-[11px] text-white/55">
                    {statusNote}
                  </div>
                  {sessionId && (
                    <button onClick={enterLanding} className="ml-2 shrink-0 rounded-xl bg-white/8 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/12">
                      Back to Sessions
                    </button>
                  )}
                </div>
                {(attachments.length > 0 || uploadError) && (
                  <div className="mb-2 space-y-1">
                    {attachments.map((item, index) => (
                      <div
                        key={`${item.name}-${index}`}
                        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/8 px-2.5 py-1.5 text-[11px] text-white/70"
                      >
                        <Paperclip className="size-3 shrink-0 text-white/40" />
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        <span className="shrink-0 text-white/35">
                          {item.method === "ocr" ? "OCR" : item.method === "spreadsheet" ? "tabel" : item.method}
                          {item.truncated ? " · dipotong" : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                          className="shrink-0 rounded-md p-0.5 text-white/35 transition hover:bg-white/10 hover:text-white/80"
                          aria-label={`Hapus lampiran ${item.name}`}
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                    {uploadError && <p className="px-1 text-[11px] text-rose-300">{uploadError}</p>}
                  </div>
                )}

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendMessage();
                  }}
                  className="flex gap-2"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.xlsx,.xls,.xlsm,.csv,.txt,.md,.tsv"
                    className="hidden"
                    onChange={(event) => handleAttach(event.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title="Lampirkan file (PDF, gambar, Excel, CSV)"
                    className="grid size-10 shrink-0 place-items-center self-end rounded-xl border border-white/20 bg-white/8 text-white/60 transition hover:bg-white/14 hover:text-white disabled:opacity-50"
                  >
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                  </button>
                  <textarea
                    ref={inputRef}
                    value={input}
                    rows={1}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter mengirim; Shift+Enter menyisipkan baris baru.
                      // IME (mis. mengetik aksara) memakai Enter untuk memilih
                      // kandidat, jadi jangan kirim saat composing.
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder={settings.scope === "general" ? "Tanyakan apapun... (Shift+Enter untuk baris baru)" : "Tanyakan data Talentpool atau hal umum... (Shift+Enter untuk baris baru)"}
                    className="min-h-[40px] max-h-40 min-w-0 flex-1 resize-none rounded-xl border border-white/20 bg-white px-3 py-2 text-sm leading-6 text-black outline-none placeholder:text-gray-600 focus:border-pink-300/70"
                  />
                  <button disabled={loading || !input.trim()} className="grid size-10 shrink-0 place-items-center self-end rounded-xl bg-pink-600 transition hover:bg-pink-500 disabled:opacity-50">
                    <Send className="size-4" />
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </WindowShell>
  );
}

function formatPlainChatText(value: string) {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim();
}

function OsAccountPopup({
  account,
  onClose,
  onLogin,
  onDashboard,
}: {
  account: OsUserAccount | null;
  onClose: () => void;
  onLogin: () => void;
  onDashboard: () => void;
}) {
  const isLoggedIn = Boolean(account);

  const handleLogout = async () => {
    const db = createBrowserClient();
    await db.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/25 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute left-1/2 top-1/2 w-[min(360px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-white/18 bg-slate-950/75 text-white shadow-2xl backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Account</h2>
            <p className="text-xs text-white/50">Arkiv OS session</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-white/55 transition hover:bg-white/10 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5">
          <div className="rounded-3xl border border-white/10 bg-white/8 p-4 text-center">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-gradient-to-br from-pink-300 via-pink-500 to-rose-600 text-lg font-bold text-white shadow-lg">
              {isLoggedIn ? account?.fullName.slice(0, 1).toUpperCase() : "G"}
            </div>
            <div className="font-semibold">{isLoggedIn ? account?.fullName : "Guest"}</div>
            <div className="mt-1 text-sm text-white/55">{isLoggedIn ? account?.email : "Not logged in"}</div>
            <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold capitalize text-pink-100">
              {isLoggedIn ? account?.role.replace("_", " ") : "public access"}
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            {isLoggedIn ? (
              <>
                <button onClick={onDashboard} className="rounded-2xl bg-pink-600 px-4 py-3 text-sm font-semibold transition hover:bg-pink-500">
                  Go to Dashboard
                </button>
                <button onClick={handleLogout} className="rounded-2xl border border-white/15 bg-white/8 px-4 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/12">
                  Logout
                </button>
              </>
            ) : (
              <button onClick={onLogin} className="rounded-2xl bg-pink-600 px-4 py-3 text-sm font-semibold transition hover:bg-pink-500">
                Log In to Arkiv OS
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WallpaperPicker({ selected, onSelect, onClose }: { selected: string; onSelect: (wallpaper: (typeof wallpapers)[number]) => void; onClose: () => void }) {
  return (
    <WindowShell title="Desktop & Wallpaper" onClose={onClose} className="left-1/2 top-20 w-[min(640px,calc(100vw-32px))] -translate-x-1/2">
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        {wallpapers.map((item) => (
          <button key={item.id} onClick={() => onSelect(item)} className={`rounded-3xl border p-3 text-left transition hover:bg-white/10 ${selected === item.id ? "border-pink-200/60 bg-white/14" : "border-white/10 bg-white/8"}`}>
            <div className="mb-3 h-24 rounded-2xl bg-cover bg-center" style={item.src.startsWith("/") ? { backgroundImage: `url('${item.src}')` } : { background: item.src }} />
            <div className="text-sm font-semibold">{item.name}</div>
            <div className="text-xs text-white/45">Mac-style desktop wallpaper</div>
          </button>
        ))}
      </div>
    </WindowShell>
  );
}

function ToggleSwitch({ enabled, onChange, label }: { enabled: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative h-7 w-12 rounded-full border transition ${enabled ? "border-pink-200/50 bg-pink-500" : "border-white/15 bg-white/10"}`}
      aria-label={label}
    >
      <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition ${enabled ? "left-6" : "left-1"}`} />
    </button>
  );
}

function LlmModelLogo({
  model,
  className = "size-8",
  imageClassName = "size-6",
}: {
  model: (typeof AI_ASSISTANT_MODELS)[number];
  className?: string;
  imageClassName?: string;
}) {
  return (
    <span className={`grid ${className} shrink-0 place-items-center overflow-hidden rounded-xl border border-white/12 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,.34)]`}>
      {model.logoSrc ? (
        <Image src={model.logoSrc} alt={`${model.label} logo`} width={28} height={28} className={`${imageClassName} object-contain`} />
      ) : (
        <span className={`grid h-full w-full place-items-center bg-gradient-to-br ${model.logoClassName} text-[10px] font-black`}>
          {model.logo}
        </span>
      )}
    </span>
  );
}

function SystemSettings({
  soundEnabled,
  assistantSettings,
  onSoundChange,
  onAssistantSettingsChange,
  onOpenWallpaper,
  onOpenWidgets,
  onOpenWaNotif,
  onClose,
}: {
  soundEnabled: boolean;
  assistantSettings: AiAssistantSettings;
  onSoundChange: (value: boolean) => void;
  onAssistantSettingsChange: (next: Partial<AiAssistantSettings>) => void;
  onOpenWallpaper: () => void;
  onOpenWidgets: () => void;
  onOpenWaNotif: () => void;
  onClose: () => void;
}) {
  const settings = [
    { title: "Desktop & Wallpaper", description: "Pilih wallpaper Arkiv OS.", icon: MonitorDot, action: onOpenWallpaper },
    { title: "Widgets", description: "Atur Calendar dan System Widgets.", icon: Activity, action: onOpenWidgets },
    { title: "Notifikasi WA", description: "Kabar penting bisnis dikirim otomatis ke WhatsApp.", icon: Bell, action: onOpenWaNotif },
  ];
  const SoundIcon = soundEnabled ? Volume2 : VolumeX;
  const [showModelMenu, setShowModelMenu] = useState(false);
  const activeModel = AI_ASSISTANT_MODELS.find((model) => model.id === assistantSettings.model) ?? AI_ASSISTANT_MODELS[0];

  return (
    <WindowShell title="System Settings" onClose={onClose} className="left-1/2 top-16 w-[min(760px,calc(100vw-32px))] -translate-x-1/2">
      <div className="grid gap-4 p-5 md:grid-cols-[220px_1fr]">
        <aside className="rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className={`mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br ${pinkAccent}`}><Settings className="size-6" /></div>
          <div className="font-semibold">Arkiv OS Settings</div>
          <div className="mt-1 text-xs leading-5 text-white/50">Theme, widgets, sound, Do, dan desktop preferences.</div>
        </aside>
        <section className="space-y-3">
          <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br ${pinkAccent}`}><Bot className="size-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Do</div>
                <div className="truncate text-xs leading-5 text-white/45">{assistantSettings.model}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/40">Context</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {AI_ASSISTANT_SCOPES.map((scope) => (
                  <button
                    key={scope.id}
                    onClick={() => onAssistantSettingsChange({ scope: scope.id })}
                    className={`min-h-11 rounded-2xl border px-3 py-2 text-center text-xs font-semibold transition ${assistantSettings.scope === scope.id ? "border-pink-300/60 bg-pink-500/18 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.14)]" : "border-white/10 bg-black/15 text-white/60 hover:bg-white/10"}`}
                    title={scope.description}
                  >
                    {scope.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">LLM Model</div>
              <button
                type="button"
                onClick={() => setShowModelMenu((value) => !value)}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/12 bg-zinc-950/45 px-3 py-3 text-left text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_12px_32px_rgba(0,0,0,.24)] outline-none transition hover:border-white/20 hover:bg-zinc-900/60 active:bg-zinc-950/80 focus-visible:bg-zinc-950/70 focus-visible:ring-2 focus-visible:ring-white/16"
                aria-haspopup="listbox"
                aria-expanded={showModelMenu}
              >
                <LlmModelLogo model={activeModel} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{activeModel.label}</div>
                  <div className="truncate text-[11px] text-white/55">{activeModel.description}</div>
                </div>
                <ChevronDown className={`size-4 text-white/55 transition ${showModelMenu ? "rotate-180" : ""}`} />
              </button>

              {showModelMenu && (
                <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[90] overflow-hidden rounded-2xl border border-white/12 bg-zinc-950/95 p-1.5 text-white shadow-[0_24px_70px_rgba(0,0,0,.46)] backdrop-blur-2xl ring-1 ring-black/30" role="listbox" data-arkiv-ai-listbox="true">
                  {AI_ASSISTANT_MODELS.map((model) => {
                    const selected = assistantSettings.model === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          onAssistantSettingsChange({ model: resolveAiAssistantModel(model.id) });
                          setShowModelMenu(false);
                        }}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition active:bg-zinc-800/80 focus-visible:bg-zinc-800/70 focus-visible:outline-none ${selected ? "bg-white/[0.14] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)]" : "text-white/72 hover:bg-white/[0.08] hover:text-white"}`}
                        role="option"
                        aria-selected={selected}
                      >
                        <LlmModelLogo model={model} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{model.label}</span>
                          <span className="block truncate text-[11px] text-white/52">{model.description}</span>
                        </span>
                        {selected && <Check className="size-4 shrink-0 text-white/75" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {settings.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.title} onClick={item.action} className="flex w-full items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4 text-left transition hover:bg-white/12">
                <div className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br ${pinkAccent}`}><Icon className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{item.title}</div>
                  <div className="text-xs leading-5 text-white/45">{item.description}</div>
                </div>
                <ChevronRight className="size-4 text-white/35" />
              </button>
            );
          })}
          <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4">
            <div className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br ${pinkAccent}`}><SoundIcon className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Sound Effects</div>
              <div className="text-xs leading-5 text-white/45">Subtle click sound ala desktop OS. Default off.</div>
            </div>
            <ToggleSwitch enabled={soundEnabled} onChange={onSoundChange} label="Toggle sound effects" />
          </div>
        </section>
      </div>
    </WindowShell>
  );
}

function WidgetSettings({
  visibility,
  order,
  onChange,
  onMove,
  onClose,
}: {
  visibility: WidgetVisibility;
  order: MonitorWidgetKey[];
  onChange: (key: keyof WidgetVisibility, value: boolean) => void;
  onMove: (key: MonitorWidgetKey, direction: -1 | 1) => void;
  onClose: () => void;
}) {
  // Baris widget monitoring mengikuti urutan pilihan user (Fase C); Calendar
  // adalah window mengambang, bukan bagian papan, jadi tanpa kontrol urutan.
  const monitorItems = order
    .map((key) => MONITOR_WIDGETS.find((w) => w.key === key))
    .filter((w): w is (typeof MONITOR_WIDGETS)[number] => Boolean(w));
  const calendar = { key: "calendar" as const, title: "Calendar Widget", description: "Kalender bulanan yang bisa dipindahkan dan di-resize." };

  return (
    <WindowShell title="Widgets" onClose={onClose} className="left-1/2 top-24 w-[min(460px,calc(100vw-32px))] -translate-x-1/2">
      <div className="space-y-3 p-5">
        <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className="text-sm font-semibold">Desktop Widgets</div>
          <div className="mt-1 text-xs leading-5 text-white/50">Calendar Widget aktif secara default. Widget monitoring bisa diaktifkan dan diatur urutannya dengan tombol panah — urutan tersimpan di perangkat ini.</div>
        </div>
        <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className={`grid size-11 place-items-center rounded-2xl bg-gradient-to-br ${pinkAccent}`}><CalendarDays className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{calendar.title}</div>
            <div className="text-xs leading-5 text-white/45">{calendar.description}</div>
          </div>
          <ToggleSwitch enabled={visibility.calendar} onChange={(value) => onChange("calendar", value)} label={`Toggle ${calendar.title}`} />
        </div>
        {monitorItems.map((item, index) => (
          <div key={item.key} className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4">
            <div className="flex shrink-0 flex-col gap-0.5">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => onMove(item.key, -1)}
                aria-label={`Naikkan urutan ${item.title}`}
                className="rounded-lg p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                type="button"
                disabled={index === monitorItems.length - 1}
                onClick={() => onMove(item.key, 1)}
                aria-label={`Turunkan urutan ${item.title}`}
                className="rounded-lg p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>
            <div className={`grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${pinkAccent}`}><Activity className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{item.title}</div>
              <div className="text-xs leading-5 text-white/45">{item.description}</div>
            </div>
            <ToggleSwitch enabled={visibility[item.key]} onChange={(value) => onChange(item.key, value)} label={`Toggle ${item.title}`} />
          </div>
        ))}
      </div>
    </WindowShell>
  );
}

function AboutArkiv({ onClose }: { onClose: () => void }) {
  return (
    <WindowShell title="About This Arkiv" onClose={onClose} className="left-1/2 top-24 w-[min(420px,calc(100vw-32px))] -translate-x-1/2">
      <div className="p-6 text-center">
        <div className={`mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-gradient-to-br ${pinkAccent}`}><MonitorDot className="size-8" /></div>
        <h2 className="text-xl font-semibold">Arkiv</h2>
        <p className="mt-2 text-sm leading-6 text-white/60">Desktop portal untuk HRIS, Procurement, POS, CRM, dan Do.</p>
        <div className="mt-5 rounded-2xl bg-white/8 p-3 text-xs text-white/50">Version 1.0 · macOS-inspired shell</div>
      </div>
    </WindowShell>
  );
}

function DesktopContextMenu({ x, y, onWallpaper, onWidgets, onApps, onSettings, onAbout }: { x: number; y: number; onWallpaper: () => void; onWidgets: () => void; onApps: () => void; onSettings: () => void; onAbout: () => void }) {
  return (
    <div className="fixed z-50 w-52 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/80 p-1 text-sm shadow-2xl backdrop-blur-xl" style={{ left: x, top: y }}>
      <button onClick={onApps} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">Open Launchpad</button>
      <button onClick={onWidgets} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">Widgets</button>
      <button onClick={onSettings} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">System Settings</button>
      <button onClick={onWallpaper} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">Change Wallpaper</button>
      <button onClick={onAbout} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">About Arkiv OS</button>
    </div>
  );
}

function ContextMenu({ x, y, module, onOpen, onInfo }: { x: number; y: number; module: DesktopModule; onOpen: () => void; onInfo: () => void }) {
  return (
    <div className="fixed z-50 w-44 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/80 p-1 text-sm shadow-2xl backdrop-blur-xl" style={{ left: x, top: y }}>
      <button disabled={module.disabled} onClick={onOpen} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10 disabled:opacity-50">Open</button>
      <button onClick={onInfo} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">View Info</button>
      <button className="block w-full rounded-xl px-3 py-2 text-left text-white/45">Pin to Dock</button>
    </div>
  );
}
