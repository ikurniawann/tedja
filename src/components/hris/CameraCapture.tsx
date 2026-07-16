"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Dialog selfie absensi: kamera depan via getUserMedia → capture ke canvas
 * (JPEG 640px) → preview + ulangi → konfirmasi. Foto wajib — tanpa kamera,
 * absen tidak bisa dilakukan (fallback: koreksi manual oleh HRD).
 */

interface CameraCaptureProps {
  open: boolean;
  title?: string;
  onConfirm: (photoDataUrl: string) => void;
  onCancel: () => void;
}

const CAPTURE_WIDTH = 640;
const JPEG_QUALITY = 0.8;

export function CameraCapture({ open, title = "Ambil Foto Selfie", onConfirm, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startStream = useCallback(async () => {
    setError(null);
    setPhoto(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      setError(
        "Kamera tidak dapat diakses. Izinkan akses kamera di browser, lalu coba lagi. " +
          "Tanpa foto, absen tidak dapat dilakukan."
      );
    }
  }, []);

  useEffect(() => {
    if (open) {
      startStream();
    } else {
      stopStream();
      setPhoto(null);
      setError(null);
    }
    return stopStream;
  }, [open, startStream, stopStream]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const scale = CAPTURE_WIDTH / video.videoWidth;
    const canvas = document.createElement("canvas");
    canvas.width = CAPTURE_WIDTH;
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // mirror horizontal agar sesuai preview kamera depan
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    stopStream();
  }

  function handleRetake() {
    startStream();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" /> {title}
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">{error}</p>
        ) : photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="Preview selfie" className="w-full rounded-lg" />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full -scale-x-100 rounded-lg bg-black"
          />
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>
            <X className="mr-1 h-4 w-4" /> Batal
          </Button>
          {error ? (
            <Button onClick={startStream}>
              <RefreshCw className="mr-1 h-4 w-4" /> Coba Lagi
            </Button>
          ) : photo ? (
            <>
              <Button variant="outline" onClick={handleRetake}>
                <RefreshCw className="mr-1 h-4 w-4" /> Ulangi
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => onConfirm(photo)}
              >
                <Check className="mr-1 h-4 w-4" /> Gunakan Foto Ini
              </Button>
            </>
          ) : (
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleCapture}>
              <Camera className="mr-1 h-4 w-4" /> Ambil Foto
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
