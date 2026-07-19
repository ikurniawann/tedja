"use client";

import {
  AlertTriangle,
  Camera,
  CameraOff,
  ClipboardPaste,
  Expand,
  Loader2,
  ScanFace,
  Users,
  WifiOff,
} from "lucide-react";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
} from "@/components/ui/dialog";
import { useInterviewProctorEvents } from "../queries";
import type { InterviewAiSession, InterviewProctorEvent } from "../api";

const FLAG_META: Record<
  Exclude<InterviewProctorEvent["event_type"], "webcam_snapshot">,
  { label: string; icon: React.ReactNode }
> = {
  tab_blur: { label: "Pindah tab / aplikasi", icon: <AlertTriangle className="size-3.5" /> },
  fullscreen_exit: { label: "Keluar layar penuh", icon: <Expand className="size-3.5" /> },
  paste: { label: "Paste terdeteksi", icon: <ClipboardPaste className="size-3.5" /> },
  disconnect: { label: "Koneksi terputus", icon: <WifiOff className="size-3.5" /> },
  face_not_detected: { label: "Wajah keluar frame", icon: <ScanFace className="size-3.5" /> },
  multiple_faces: { label: "Lebih dari satu wajah", icon: <Users className="size-3.5" /> },
  camera_off: { label: "Kamera dimatikan", icon: <CameraOff className="size-3.5" /> },
};

interface InterviewProctorDialogProps {
  session: InterviewAiSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Arsip bukti proctoring satu sesi interview AI (EPIC-003): flag perilaku
 * (tab/wajah/kamera) berkelompok + galeri snapshot webcam (storage private,
 * disajikan via /api/interview/files yang ber-auth).
 */
export function InterviewProctorDialog({
  session,
  open,
  onOpenChange,
}: InterviewProctorDialogProps) {
  const eventsQuery = useInterviewProctorEvents(open ? session.id : null);
  const events = eventsQuery.data ?? [];

  const flags = events.filter(
    (e): e is InterviewProctorEvent & { event_type: keyof typeof FLAG_META } =>
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
          <DialogPanelTitle>Analitik & Bukti Proctoring Interview</DialogPanelTitle>
          <DialogPanelDescription>
            {session.invited_at &&
              `Sesi ${new Date(session.invited_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })} · `}
            interview wajib on-cam — kamera aktif sepanjang sesi
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
                  <p className="text-sm text-emerald-600 dark:text-emerald-400">
                    Tidak ada flag — kandidat on-cam dan tidak terdeteksi meninggalkan interview.
                  </p>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap gap-2">
                      {Object.entries(flagCounts).map(([type, count]) => (
                        <span
                          key={type}
                          className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                        >
                          {FLAG_META[type as keyof typeof FLAG_META].icon}
                          {FLAG_META[type as keyof typeof FLAG_META].label} × {count}
                        </span>
                      ))}
                    </div>
                    <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
                      {flags.map((event) => (
                        <li key={event.id} className="flex items-center justify-between px-3 py-1.5">
                          <span className="flex items-center gap-2 text-foreground/80">
                            {FLAG_META[event.event_type].icon}
                            {FLAG_META[event.event_type].label}
                            {event.meta?.offline_seconds != null &&
                              ` (${event.meta.offline_seconds} detik)`}
                            {event.meta?.faces != null && ` (${event.meta.faces} wajah)`}
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
                  <p className="text-sm text-muted-foreground">Tidak ada snapshot pada sesi ini.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {snapshots.map((snapshot) => (
                      <figure key={snapshot.id} className="space-y-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/interview/files/${snapshot.storage_path}`}
                          alt="Snapshot proctoring interview"
                          loading="lazy"
                          className="aspect-[4/3] w-full rounded-md border border-border object-cover"
                        />
                        <figcaption className="text-center text-[10px] text-muted-foreground">
                          {new Date(snapshot.created_at).toLocaleTimeString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {snapshot.meta?.trigger === "face_not_detected" && (
                            <span className="block font-medium text-amber-600 dark:text-amber-400">
                              saat keluar frame
                            </span>
                          )}
                          {snapshot.meta?.trigger === "multiple_faces" && (
                            <span className="block font-medium text-amber-600 dark:text-amber-400">
                              saat &gt;1 wajah
                            </span>
                          )}
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
