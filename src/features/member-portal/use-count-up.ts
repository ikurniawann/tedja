"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Menghitung angka naik dari 0 ke `target` saat pertama tampil.
 *
 * Dipakai untuk saldo & XP di kartu member. Menghormati prefers-reduced-motion
 * (langsung tampilkan nilai akhir) dan berhenti rapi saat komponen dilepas,
 * supaya tidak ada setState pada komponen yang sudah tidak ada.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    const safeTarget = Number.isFinite(target) ? target : 0;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || durationMs <= 0 || safeTarget === fromRef.current) {
      fromRef.current = safeTarget;
      setValue(safeTarget);
      return;
    }

    // Animasi berikutnya berangkat dari nilai saat ini, bukan selalu dari 0 —
    // jadi saldo yang berubah (mis. setelah redeem) ikut bergerak halus.
    const from = fromRef.current;
    const delta = safeTarget - from;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // easeOutExpo: cepat di awal lalu melambat — terasa "mendarat".
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(from + delta * eased);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = safeTarget;
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs]);

  return value;
}
