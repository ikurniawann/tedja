"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CameraCapture } from "@/components/hris/CameraCapture";

/**
 * Panel clock-in/out ESS: selfie kamera WAJIB + lokasi GPS.
 * Alur: klik tombol → kamera (capture+konfirmasi) → ambil GPS → POST.
 * State absensi hari ini dipulihkan dari server (tahan refresh).
 */

interface TodayAttendance {
  id: string;
  clock_in: string | null;
  clock_out: string | null;
  is_late: boolean;
  late_minutes: number;
}

function timeLabel(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

export function EssClockPanel({ onChanged }: { onChanged?: () => void }) {
  const { toast } = useToast();
  const [today, setToday] = useState<TodayAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cameraFor, setCameraFor] = useState<"clock-in" | "clock-out" | null>(null);

  const refresh = useCallback(() => {
    const date = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    fetch(`/api/hris/attendance?employee_id=me&date=${date}&limit=1`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setToday(json?.data?.[0] ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  function getLocation(): Promise<{ latitude: number; longitude: number; accuracy?: number } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  async function submit(action: "clock-in" | "clock-out", photo: string) {
    setCameraFor(null);
    setSubmitting(true);
    try {
      const location = await getLocation();
      const body: Record<string, unknown> = { action, photo };
      if (action === "clock-in") {
        if (location) body.clock_in_location = location;
      } else {
        body.attendance_id = today?.id;
        if (location) body.clock_out_location = location;
      }
      const res = await fetch("/api/hris/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal memproses absen");

      const late = json.data?.is_late
        ? ` — terlambat ${json.data.late_minutes} menit`
        : "";
      toast({
        title: action === "clock-in" ? "✅ Clock-in berhasil" : "✅ Clock-out berhasil",
        description: `${new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })}${late}${location ? " · 📍 lokasi tercatat" : ""}`,
      });
      refresh();
      onChanged?.();
    } catch (error) {
      toast({
        title: "Gagal",
        description: error instanceof Error ? error.message : "Coba lagi",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const clockedIn = Boolean(today?.clock_in);
  const clockedOut = Boolean(today?.clock_out);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="h-12 bg-green-600 px-6 hover:bg-green-700"
          disabled={loading || submitting || clockedIn}
          onClick={() => setCameraFor("clock-in")}
        >
          {submitting && cameraFor !== "clock-out" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Clock className="mr-2 h-4 w-4" />
          )}
          Clock In
        </Button>
        <Button
          variant="outline"
          className="h-12 px-6"
          disabled={loading || submitting || !clockedIn || clockedOut}
          onClick={() => setCameraFor("clock-out")}
        >
          <Clock className="mr-2 h-4 w-4" /> Clock Out
        </Button>
        <p className="flex items-center gap-1 text-xs text-gray-500">
          <MapPin className="h-3.5 w-3.5" /> Foto selfie & lokasi GPS wajib disertakan
        </p>
      </div>

      {clockedIn && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span>
            Masuk <b>{timeLabel(today!.clock_in)}</b>
            {clockedOut ? (
              <>
                {" "}· Pulang <b>{timeLabel(today!.clock_out)}</b>
              </>
            ) : null}
          </span>
          {today!.is_late ? (
            <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
              Terlambat {today!.late_minutes} mnt
            </Badge>
          ) : (
            <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Tepat waktu</Badge>
          )}
          {clockedOut && (
            <Badge variant="outline" className="text-green-700">
              Absensi hari ini selesai
            </Badge>
          )}
        </div>
      )}

      <CameraCapture
        open={cameraFor !== null}
        title={cameraFor === "clock-out" ? "Selfie Clock-Out" : "Selfie Clock-In"}
        onConfirm={(photo) => cameraFor && submit(cameraFor, photo)}
        onCancel={() => setCameraFor(null)}
      />
    </div>
  );
}
