"use client";

import { AlertTriangle, Camera, ClipboardPaste, Expand, Loader2, WifiOff } from "lucide-react";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
} from "@/components/ui/dialog";
import { usePsikotesProctorEvents } from "../queries";
import type { PsikotesProctorEvent, PsikotesSession } from "../api";

const FLAG_META: Record<
  Exclude<PsikotesProctorEvent["event_type"], "webcam_snapshot">,
  { label: string; icon: React.ReactNode }
> = {
  tab_blur: { label: "Pindah tab / aplikasi", icon: <AlertTriangle className="size-3.5" /> },
  fullscreen_exit: { label: "Keluar layar penuh", icon: <Expand className="size-3.5" /> },
  paste: { label: "Paste terdeteksi", icon: <ClipboardPaste className="size-3.5" /> },
  disconnect: { label: "Koneksi terputus", icon: <WifiOff className="size-3.5" /> },
};

interface PsikotesProctorDialogProps {
  session: PsikotesSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Arsip bukti proctoring satu sesi (EPIC-002 TG5):
 * rekap flag perilaku berkelompok + galeri snapshot webcam (storage private,
 * disajikan via /api/psikotes/files yang ber-auth).
 */
export function PsikotesProctorDialog({ session, open, onOpenChange }: PsikotesProctorDialogProps) {
  const eventsQuery = usePsikotesProctorEvents(open ? session.id : null);
  const events = eventsQuery.data ?? [];

  const flags = events.filter(
    (e): e is PsikotesProctorEvent & { event_type: keyof typeof FLAG_META } =>
      e.event_type !== "webcam_snapshot"
  );
  const snapshots = events.filter((e) => e.event_type === "webcam_snapshot" && e.storage_path);

  const flagCounts = flags.reduce<Record<string, number>>((acc, e) => {
    acc[e.event_type] = (acc[e.event_type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>Arsip Bukti Proctoring</DialogPanelTitle>
          <DialogPanelDescription>
            {session.invited_at &&
              `Sesi ${new Date(session.invited_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })} · `}
            consent kamera: {session.webcam_consent ? "diberikan" : "tidak diberikan"}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {eventsQuery.isLoading ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              Tidak ada flag maupun snapshot pada sesi ini.
            </p>
          ) : (
            <>
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Flag Perilaku ({flags.length})
                </h4>
                {flags.length === 0 ? (
                  <p className="text-sm text-emerald-600">
                    Tidak ada flag — kandidat tidak terdeteksi meninggalkan tes.
                  </p>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap gap-2">
                      {Object.entries(flagCounts).map(([type, count]) => (
                        <span
                          key={type}
                          className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800"
                        >
                          {FLAG_META[type as keyof typeof FLAG_META].icon}
                          {FLAG_META[type as keyof typeof FLAG_META].label} × {count}
                        </span>
                      ))}
                    </div>
                    <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
                      {flags.map((event) => (
                        <li key={event.id} className="flex items-center justify-between px-3 py-1.5">
                          <span className="flex items-center gap-2 text-gray-700">
                            {FLAG_META[event.event_type].icon}
                            {FLAG_META[event.event_type].label}
                            {event.meta?.offline_seconds != null &&
                              ` (${event.meta.offline_seconds} detik)`}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(event.created_at).toLocaleTimeString("id-ID", {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Camera className="size-3.5" /> Snapshot Webcam ({snapshots.length})
                </h4>
                {snapshots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Tidak ada snapshot{session.webcam_consent ? "" : " (kandidat tidak memberi consent kamera)"}.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {snapshots.map((snapshot) => (
                      <figure key={snapshot.id} className="space-y-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/psikotes/files/${snapshot.storage_path}`}
                          alt="Snapshot proctoring"
                          loading="lazy"
                          className="aspect-[4/3] w-full rounded-md border border-border object-cover"
                        />
                        <figcaption className="text-center text-[10px] text-muted-foreground">
                          {new Date(snapshot.created_at).toLocaleTimeString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
