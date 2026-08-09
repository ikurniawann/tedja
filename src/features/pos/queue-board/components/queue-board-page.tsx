"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Volume2,
  VolumeX,
  RefreshCw,
  Maximize2,
  Minimize2,
  Utensils,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { KDSOrder } from "@/features/pos/kds/types";
import { unlockQueueBoardSound, useQueueBoard } from "../queries";

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: "Dine In",
  takeaway: "Bungkus",
  pickup: "Ambil",
  delivery: "Delivery",
};

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    dateFrom: start.toISOString(),
    dateTo: end.toISOString(),
  };
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function QueueCard({
  order,
  emphasis,
}: {
  order: KDSOrder;
  emphasis: "preparing" | "ready";
}) {
  const ready = emphasis === "ready";
  return (
    <article
      className={`rounded-2xl border p-4 sm:p-5 ${
        ready
          ? "border-emerald-400/40 bg-emerald-500/15 shadow-[0_0_24px_rgba(16,185,129,0.18)]"
          : "border-white/10 bg-white/5"
      }`}
    >
      <p
        className={`font-black tabular-nums leading-none tracking-tight ${
          ready ? "text-6xl text-emerald-300 sm:text-7xl" : "text-5xl text-amber-200 sm:text-6xl"
        }`}
      >
        {order.queue_number || "—"}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-white/60">
        {order.order_type === "dine_in" ? (
          <Utensils className="h-3.5 w-3.5" />
        ) : (
          <ShoppingBag className="h-3.5 w-3.5" />
        )}
        <span>{ORDER_TYPE_LABELS[order.order_type] || order.order_type}</span>
        {(order.table_label || order.table_id) && (
          <span>· {order.table_label || `Meja ${String(order.table_id).slice(0, 6)}`}</span>
        )}
      </p>
      <ul className="mt-3 space-y-1 text-sm text-white/80">
        {(order.pos_order_items || []).slice(0, 4).map((item) => (
          <li key={item.id} className="truncate">
            <span className="font-semibold text-white/50">{item.quantity}×</span> {item.product_name}
          </li>
        ))}
        {(order.pos_order_items || []).length > 4 ? (
          <li className="text-xs text-white/40">
            +{(order.pos_order_items || []).length - 4} item lain
          </li>
        ) : null}
      </ul>
    </article>
  );
}

type QueueBoardPageProps = {
  venueName?: string | null;
};

export function QueueBoardPage({ venueName }: QueueBoardPageProps) {
  const todayRange = getTodayRange();
  const [now, setNow] = useState(() => new Date());
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const { preparing, ready, loading, error, soundEnabled, setSoundEnabled, refresh } =
    useQueueBoard({
      dateFrom: todayRange.dateFrom,
      dateTo: todayRange.dateTo,
      pollInterval: 3000,
    });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const sync = () => setIsBrowserFullscreen(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleBrowserFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
    } catch {
      toast.error("Browser menolak layar penuh. Coba klik lagi, atau tekan F11.");
    }
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">Antrian</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {venueName || "Ambil pesanan Anda"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <p className="mr-2 hidden font-mono text-xl tabular-nums text-white/70 sm:block">
            {formatClock(now)}
          </p>
          <Button
            size="icon"
            variant="ghost"
            className="text-white/60 hover:text-white"
            onClick={() => {
              setSoundEnabled((value) => {
                const next = !value;
                if (next) unlockQueueBoardSound();
                return next;
              });
            }}
            title={soundEnabled ? "Matikan bunyi" : "Nyalakan bunyi"}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white/60 hover:text-white"
            onClick={() => void refresh()}
            title="Muat ulang"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white/60 hover:text-white"
            onClick={() => void toggleBrowserFullscreen()}
            title={isBrowserFullscreen ? "Keluar layar penuh" : "Layar penuh"}
          >
            {isBrowserFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {error ? (
        <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col rounded-3xl border border-amber-400/20 bg-amber-500/5 p-4">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-amber-200/80">
                Sedang disiapkan
              </p>
              <p className="text-white/50">{preparing.length} antrian</p>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {preparing.length === 0 ? (
              <p className="py-16 text-center text-white/35">Belum ada antrian</p>
            ) : (
              preparing.map((order) => (
                <QueueCard key={order.id} order={order} emphasis="preparing" />
              ))
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-3xl border border-emerald-400/25 bg-emerald-500/10 p-4">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-emerald-200">
                Siap diambil
              </p>
              <p className="text-white/50">{ready.length} antrian</p>
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {ready.length === 0 ? (
              <p className="py-16 text-center text-white/35">Belum ada yang siap</p>
            ) : (
              ready.map((order) => (
                <QueueCard key={order.id} order={order} emphasis="ready" />
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
