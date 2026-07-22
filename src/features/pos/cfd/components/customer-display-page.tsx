"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2 } from "lucide-react";
import {
  CFD_DONE_HOLD_MS,
  idleCfdState,
  subscribeCfdState,
  type CfdState,
} from "@/lib/pos/cfd";

/**
 * EPIC-024 — layar menghadap customer (monitor kedua PC kasir).
 * Read-only: subscribe state dari kasir via BroadcastChannel. Buka
 * window ini, drag ke monitor kedua, F11 fullscreen.
 */

const formatRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

const METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  credit_card: "Kartu",
  ark_coin: "ARK Coin",
  nfc_tab: "NFC Tab",
};

export function CustomerDisplayPage() {
  const [view, setView] = useState<CfdState>(() => idleCfdState());
  const listEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Layar done ditahan CFD_DONE_HOLD_MS — clearCart kasir langsung
    // mem-publish idle, customer tetap harus sempat membaca kembaliannya.
    // Penundaan diputuskan di callback (bukan saat render — hooks purity).
    let doneShownAt = 0;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeCfdState((next) => {
      if (next.status === "done") {
        doneShownAt = Date.now();
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        setView(next);
        return;
      }
      const remaining = CFD_DONE_HOLD_MS - (Date.now() - doneShownAt);
      if (next.status === "idle" && remaining > 0) {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => setView(next), remaining);
        return;
      }
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      setView(next);
    });
    return () => {
      unsubscribe();
      if (holdTimer) clearTimeout(holdTimer);
    };
  }, []);

  // Item terbaru selalu terlihat
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [view.items.length]);

  return (
    <div className="flex h-dvh flex-col bg-gray-950 text-white">
      {view.status === "idle" ? (
        <IdleScreen />
      ) : view.status === "done" ? (
        <DoneScreen state={view} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Daftar item */}
          <div className="flex min-h-0 flex-1 flex-col p-8">
            {view.member_name ? (
              <p className="mb-3 text-lg text-pink-300">
                Halo, {view.member_name} 👋
              </p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto pr-2">
              <table className="w-full text-lg">
                <tbody>
                  {view.items.map((item, index) => (
                    <tr key={index} className="border-b border-white/10">
                      <td className="py-3 pr-3">
                        <span className="text-white">{item.name}</span>
                        <span className="ml-2 text-sm text-white/50">
                          × {item.qty}
                        </span>
                      </td>
                      <td className="py-3 text-right font-medium text-white">
                        {formatRp(item.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div ref={listEndRef} />
            </div>
          </div>

          {/* Panel total / pembayaran */}
          <div className="flex w-[42%] flex-col justify-between border-l border-white/10 bg-white/5 p-8">
            {view.status === "payment" && view.payment ? (
              <PaymentPanel state={view} />
            ) : (
              <div />
            )}
            <div className="space-y-1.5 text-right">
              <Row label="Subtotal" value={formatRp(view.subtotal)} muted />
              {view.discount > 0 ? (
                <Row
                  label="Diskon member"
                  value={`− ${formatRp(view.discount)}`}
                  accent
                />
              ) : null}
              {view.tax > 0 ? (
                <Row label="Pajak" value={formatRp(view.tax)} muted />
              ) : null}
              {view.ark_used > 0 ? (
                <Row
                  label="ARK Coin"
                  value={`− ${formatRp(view.ark_used)}`}
                  accent
                />
              ) : null}
              <div className="border-t border-white/15 pt-3">
                <p className="text-sm uppercase tracking-widest text-white/50">
                  Total
                </p>
                <p className="text-6xl font-bold tracking-tight">
                  {formatRp(view.total - view.ark_used)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-lg">
      <span className={accent ? "text-emerald-300" : "text-white/50"}>
        {label}
      </span>
      <span
        className={
          accent ? "font-medium text-emerald-300" : muted ? "text-white/80" : ""
        }
      >
        {value}
      </span>
    </div>
  );
}

function IdleScreen() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <p className="text-5xl font-bold tracking-tight">Selamat Datang 👋</p>
      <p className="text-xl text-white/50">
        Silakan lakukan pemesanan di kasir
      </p>
    </div>
  );
}

function PaymentPanel({ state }: { state: CfdState }) {
  const payment = state.payment!;
  if (payment.method === "qris") {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-xl font-semibold text-white/80">Scan untuk bayar</p>
        {payment.qr_loading ? (
          <div className="flex h-64 w-64 items-center justify-center rounded-2xl bg-white/10">
            <Loader2 className="h-10 w-10 animate-spin text-white/60" />
          </div>
        ) : payment.qr_string ? (
          <div className="rounded-2xl bg-white p-5">
            <QRCodeSVG value={payment.qr_string} size={256} />
          </div>
        ) : (
          <p className="text-white/50">QR belum tersedia — tunggu kasir</p>
        )}
        <p className="text-sm text-white/50">
          QRIS · nominal terkunci {formatRp(payment.amount)}
        </p>
      </div>
    );
  }
  if (payment.method === "cash") {
    return (
      <div className="space-y-2 text-right">
        <p className="text-xl font-semibold text-white/80">Pembayaran Tunai</p>
        {payment.cash_received !== undefined && payment.cash_received > 0 ? (
          <>
            <Row label="Diterima" value={formatRp(payment.cash_received)} muted />
            {payment.change !== undefined && payment.change >= 0 ? (
              <div>
                <p className="text-sm uppercase tracking-widest text-emerald-300/70">
                  Kembalian
                </p>
                <p className="text-4xl font-bold text-emerald-300">
                  {formatRp(payment.change)}
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }
  return (
    <p className="text-right text-xl font-semibold text-white/80">
      Pembayaran {METHOD_LABELS[payment.method] ?? payment.method}
    </p>
  );
}

function DoneScreen({ state }: { state: CfdState }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <p className="text-6xl">🙏</p>
      <p className="text-5xl font-bold tracking-tight">Terima Kasih!</p>
      {state.done_change !== undefined && state.done_change > 0 ? (
        <p className="text-2xl text-emerald-300">
          Kembalian: {formatRp(state.done_change)}
        </p>
      ) : null}
      <p className="text-lg text-white/50">Sampai jumpa kembali ✨</p>
    </div>
  );
}
