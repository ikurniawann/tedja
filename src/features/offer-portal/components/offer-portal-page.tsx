"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Clock,
  Handshake,
  Loader2,
  PartyPopper,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { fetchOffer, respondOffer } from "../api";
import type { OfferPortalData, OfferRespondAction } from "../types";

function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function StatusShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4">
      <Card className="w-full max-w-md p-6 text-center">{children}</Card>
    </div>
  );
}

/**
 * Portal offer kandidat (EPIC-004): lihat rincian penawaran kerja lalu
 * merespons — Terima / Ajukan Nego / Tolak. Respons + timestamp + IP
 * tercatat sebagai bukti digital di sisi HRD.
 */
export function OfferPortalPage({ token }: { token: string }) {
  const [offer, setOffer] = useState<OfferPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<OfferRespondAction | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setOffer(await fetchOffer(token));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Gagal memuat penawaran");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleRespond = async (action: OfferRespondAction) => {
    setSubmitting(true);
    setActionError(null);
    try {
      await respondOffer(token, action, note.trim() || undefined);
      setMode(null);
      setNote("");
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Gagal mengirim respons");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <StatusShell>
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </StatusShell>
    );
  }

  if (loadError || !offer) {
    return (
      <StatusShell>
        <AlertTriangle className="mx-auto mb-3 size-8 text-amber-500" />
        <h1 className="text-base font-semibold">Link penawaran tidak berlaku</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loadError ?? "Periksa kembali tautan dari HR, atau hubungi HR untuk informasi lebih lanjut."}
        </p>
      </StatusShell>
    );
  }

  if (offer.status === "expired") {
    return (
      <StatusShell>
        <Clock className="mx-auto mb-3 size-8 text-red-500" />
        <h1 className="text-base font-semibold">Penawaran sudah kedaluwarsa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Masa berlaku penawaran ini telah berakhir. Silakan hubungi HR untuk informasi lebih
          lanjut.
        </p>
      </StatusShell>
    );
  }

  if (offer.status === "accepted") {
    return (
      <StatusShell>
        <PartyPopper className="mx-auto mb-3 size-8 text-emerald-500" />
        <h1 className="text-base font-semibold">
          Selamat bergabung, {offer.candidate_name}! 🎉
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Anda telah menerima penawaran ini
          {offer.responded_at &&
            ` pada ${new Date(offer.responded_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}`}
          . Tim HR akan menghubungi Anda untuk proses onboarding.
        </p>
      </StatusShell>
    );
  }

  if (offer.status === "declined") {
    return (
      <StatusShell>
        <XCircle className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h1 className="text-base font-semibold">Penawaran telah Anda tolak</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Terima kasih atas waktunya, {offer.candidate_name}. Semoga sukses selalu — data Anda
          tetap kami simpan untuk peluang yang sesuai di masa mendatang.
        </p>
      </StatusShell>
    );
  }

  // sent / negotiating
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-8">
      <Card className="w-full max-w-lg space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold">Penawaran Kerja</h1>
          <p className="text-sm text-muted-foreground">
            Halo <span className="font-medium text-foreground">{offer.candidate_name}</span> —
            selamat! Kami dengan senang hati menawarkan Anda posisi berikut
            {offer.brand_name ? ` di ${offer.brand_name}` : ""}.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 text-sm">
            <Briefcase className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-semibold text-foreground">
              {offer.position_title ?? "Posisi yang dilamar"}
            </span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gaji pokok per bulan</p>
            <p className="text-2xl font-bold text-foreground">{formatRupiah(offer.base_salary)}</p>
          </div>
          {offer.benefits.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Benefit & tunjangan</p>
              <ul className="space-y-1">
                {offer.benefits.map((benefit, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm text-foreground">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                    {benefit}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {offer.start_date && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
              Mulai kerja:{" "}
              {new Date(offer.start_date).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </div>
          )}
          {offer.expires_at && (
            <p className="border-t border-border pt-2 text-xs text-amber-700 dark:text-amber-400">
              Mohon direspons sebelum{" "}
              {new Date(offer.expires_at).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              .
            </p>
          )}
        </div>

        {offer.status === "negotiating" && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-500/10 dark:text-blue-300">
            Pengajuan negosiasi Anda sudah tercatat
            {offer.response_note ? `: "${offer.response_note}"` : ""}. Anda tetap bisa menerima
            atau menolak penawaran ini, atau memperbarui catatan negosiasi.
          </p>
        )}

        {mode === null ? (
          <div className="space-y-2">
            <Button
              type="button"
              className="w-full"
              disabled={submitting}
              onClick={() => setMode("accept")}
            >
              <CheckCircle2 className="size-4" /> Terima Penawaran
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={submitting}
                onClick={() => setMode("negotiate")}
              >
                <Handshake className="size-4" /> Ajukan Nego
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                disabled={submitting}
                onClick={() => setMode("decline")}
              >
                <XCircle className="size-4" /> Tolak
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              {mode === "accept" && "Konfirmasi: Anda menerima penawaran ini?"}
              {mode === "negotiate" && "Tuliskan catatan negosiasi Anda"}
              {mode === "decline" && "Konfirmasi: Anda menolak penawaran ini?"}
            </p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={
                mode === "negotiate"
                  ? "Contoh: Saya berharap gaji pokok Rp X juta karena…"
                  : "Catatan tambahan (opsional)"
              }
            />
            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1"
                disabled={submitting || (mode === "negotiate" && !note.trim())}
                onClick={() => handleRespond(mode)}
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {mode === "accept" && "Ya, Saya Terima"}
                {mode === "negotiate" && "Kirim Pengajuan Nego"}
                {mode === "decline" && "Ya, Saya Tolak"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => {
                  setMode(null);
                  setActionError(null);
                }}
              >
                Batal
              </Button>
            </div>
          </div>
        )}

        {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

        <p className="text-center text-[11px] text-muted-foreground">
          Respons Anda tercatat secara digital (waktu & alamat IP) sebagai bukti persetujuan.
        </p>
      </Card>
    </div>
  );
}
