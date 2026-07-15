"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  fetchPortalSession,
  startPortalSession,
  startPortalTest,
  finishPortalSession,
  fetchLiveChat,
  sendLiveChat,
} from "../api";
import { LiveChatWidget } from "@/components/recruitment/live-chat-widget";
import { useProctoring, requestFullscreen } from "../hooks/use-proctoring";
import { McqRunner } from "./mcq-runner";
import { PapiRunner } from "./papi-runner";
import { DrawingRunner } from "./drawing-runner";
import type { PortalSessionData, PortalTest, PortalTestStartData } from "../types";

const TERMINAL_TEST_STATUSES = new Set(["selesai", "perlu_review", "reviewed"]);

function StatusShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4">
      <Card className="w-full max-w-md p-6 text-center">{children}</Card>
    </div>
  );
}

/** Portal tes kandidat: landing + consent → kerjakan battery → selesai. */
export function PsikotesPortalPage({ token }: { token: string }) {
  const [data, setData] = useState<PortalSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activeTest, setActiveTest] = useState<PortalTestStartData | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [finishSessionFailed, setFinishSessionFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await fetchPortalSession(token);
      setData(next);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Gagal memuat sesi");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const session = data?.session ?? null;
  const tests = data?.tests ?? [];
  const inProgress = session?.status === "in_progress";
  const allDone = tests.length > 0 && tests.every((t) => TERMINAL_TEST_STATUSES.has(t.status));

  useProctoring(token, Boolean(inProgress), Boolean(session?.webcam_consent));

  // live chat dgn HRD sejak link dibuka (sent) sampai sesi berjalan
  const chatFetch = useCallback((after?: string) => fetchLiveChat(token, after), [token]);
  const chatSend = useCallback((message: string) => sendLiveChat(token, message), [token]);
  const chatEnabled = session?.status === "sent" || session?.status === "in_progress";
  const chatWidget = (
    <LiveChatWidget fetchMessages={chatFetch} sendMessage={chatSend} enabled={Boolean(chatEnabled)} />
  );

  // seluruh tes selesai → tutup sesi otomatis; kegagalan tidak boleh jadi
  // jalan buntu — tampilkan tombol coba lagi (temuan review)
  const handleFinishSession = useCallback(async () => {
    setFinishSessionFailed(false);
    try {
      await finishPortalSession(token);
      await reload();
    } catch {
      setFinishSessionFailed(true);
    }
  }, [token, reload]);

  useEffect(() => {
    if (inProgress && allDone && !activeTest && !finishSessionFailed) {
      void handleFinishSession();
    }
  }, [inProgress, allDone, activeTest, finishSessionFailed, handleFinishSession]);

  const handleStartSession = async () => {
    setStarting(true);
    setActionError(null);
    try {
      await startPortalSession(token, consent);
      requestFullscreen();
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Gagal memulai sesi");
    } finally {
      setStarting(false);
    }
  };

  const handleStartTest = async (test: PortalTest) => {
    setActionError(null);
    try {
      requestFullscreen();
      const started = await startPortalTest(token, test.id);
      setActiveTest(started);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Gagal memulai tes");
    }
  };

  const handleTestFinished = () => {
    setActiveTest(null);
    void reload();
  };

  if (loading) {
    return (
      <StatusShell>
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </StatusShell>
    );
  }

  if (loadError || !session) {
    return (
      <StatusShell>
        <AlertTriangle className="mx-auto mb-3 size-8 text-amber-500" />
        <h1 className="text-base font-semibold">Link tes tidak berlaku</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loadError ?? "Periksa kembali tautan dari HR, atau hubungi HR untuk link baru."}
        </p>
      </StatusShell>
    );
  }

  if (session.status === "expired") {
    return (
      <StatusShell>
        <Clock className="mx-auto mb-3 size-8 text-red-500" />
        <h1 className="text-base font-semibold">Link tes sudah kedaluwarsa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hubungi HR untuk mendapatkan undangan tes yang baru.
        </p>
      </StatusShell>
    );
  }

  if (session.status === "completed") {
    return (
      <StatusShell>
        <PartyPopper className="mx-auto mb-3 size-8 text-emerald-500" />
        <h1 className="text-base font-semibold">Terima kasih, {session.candidate_name}!</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Seluruh rangkaian tes sudah selesai. Hasil akan ditinjau oleh tim HR dan kami akan
          menghubungi Anda untuk tahap berikutnya.
        </p>
      </StatusShell>
    );
  }

  if (session.status === "draft" || session.status === "sent") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-8">
        <Card className="w-full max-w-lg space-y-4 p-6">
          <div>
            <h1 className="text-lg font-semibold">Psikotes Online</h1>
            <p className="text-sm text-muted-foreground">
              Halo <span className="font-medium text-foreground">{session.candidate_name}</span>
              {session.position_title ? ` — posisi ${session.position_title}` : ""}. Anda akan
              mengerjakan {tests.length} tes berikut:
            </p>
          </div>

          <ul className="divide-y divide-border rounded-lg border border-border">
            {tests.map((test) => (
              <li key={test.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>{test.instrument.name}</span>
                <span className="text-xs text-muted-foreground">
                  {Math.round(test.instrument.duration_seconds / 60)} menit
                </span>
              </li>
            ))}
          </ul>

          <div className="space-y-2 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
            <p className="font-medium">Sebelum mulai:</p>
            <ul className="list-inside list-disc space-y-1">
              <li>Kerjakan sendiri di tempat tenang; jangan berpindah tab/aplikasi.</li>
              <li>Aktivitas berpindah tab, keluar layar penuh, dan paste akan tercatat.</li>
              <li>Siapkan kertas & alat tulis untuk tes gambar, dan kamera untuk memfoto hasil.</li>
            </ul>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-border px-4 py-3 text-sm">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            <span>
              <Camera className="mr-1 inline size-4 text-muted-foreground" />
              Saya mengizinkan kamera mengambil foto berkala selama tes sebagai bukti pengawasan
              (proctoring). Tanpa izin ini tes tetap bisa dikerjakan, namun tercatat tanpa bukti
              kamera.
            </span>
          </label>

          {actionError && <p className="text-sm text-red-600">{actionError}</p>}

          <Button type="button" className="w-full" onClick={handleStartSession} disabled={starting}>
            {starting && <Loader2 className="size-4 animate-spin" />}
            Mulai Sesi Tes
          </Button>
        </Card>
        {chatWidget}
      </div>
    );
  }

  // in_progress
  if (activeTest) {
    const kind = activeTest.test.instrument.kind;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-6">
        <div className="mx-auto w-full max-w-2xl">
          {kind === "mcq" && (
            <McqRunner token={token} data={activeTest} onFinished={handleTestFinished} />
          )}
          {kind === "forced_choice" && (
            <PapiRunner token={token} data={activeTest} onFinished={handleTestFinished} />
          )}
          {kind === "drawing" && (
            <DrawingRunner token={token} data={activeTest} onFinished={handleTestFinished} />
          )}
        </div>
        {chatWidget}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Rangkaian Tes Anda</h1>
          <p className="text-sm text-muted-foreground">
            Kerjakan satu per satu sampai semua selesai. Timer berjalan begitu tes dimulai.
          </p>
        </div>

        <Card className="divide-y divide-border p-0">
          {tests.map((test) => {
            const done = TERMINAL_TEST_STATUSES.has(test.status);
            const resumable = test.status === "in_progress";
            return (
              <div key={test.id} className="flex items-center gap-3 px-4 py-3">
                {done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                ) : (
                  <Clock className="size-5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{test.instrument.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {Math.round(test.instrument.duration_seconds / 60)} menit
                    {done && " · selesai"}
                    {resumable && " · sedang berjalan"}
                  </div>
                </div>
                {!done && (
                  <Button type="button" size="sm" onClick={() => handleStartTest(test)}>
                    {resumable ? "Lanjutkan" : "Mulai"} <ChevronRight className="size-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </Card>

        {finishSessionFailed && (
          <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-800">
              Semua tes selesai, tetapi penutupan sesi gagal terkirim.
            </p>
            <Button type="button" size="sm" onClick={handleFinishSession}>
              Coba Lagi
            </Button>
          </div>
        )}

        {actionError && <p className="text-sm text-red-600">{actionError}</p>}
      </div>
      {chatWidget}
    </div>
  );
}
