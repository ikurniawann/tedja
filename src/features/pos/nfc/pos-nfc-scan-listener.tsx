"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePosNfc } from "./pos-nfc-context";
import { routePosNfcCard } from "./route-card-scan";
import { createWedgeBuffer, reduceWedgeKey } from "./wedge-buffer";
import { usePosNfcBridge } from "./use-pos-nfc-bridge";

const DEBOUNCE_MS = 1000;

export function PosNfcScanListener() {
  const pathname = usePathname();
  const router = useRouter();
  const { paymentNfcActive } = usePosNfc();
  const bufferRef = useRef(createWedgeBuffer());
  const lastCommitAtRef = useRef(0);
  const paymentNfcActiveRef = useRef(paymentNfcActive);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    paymentNfcActiveRef.current = paymentNfcActive;
  }, [paymentNfcActive]);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const handleCard = useCallback(
    (card: string) => {
      const now = Date.now();
      if (now - lastCommitAtRef.current < DEBOUNCE_MS) return;
      lastCommitAtRef.current = now;

      routePosNfcCard({
        card,
        pathname: pathnameRef.current,
        paymentNfcActive: paymentNfcActiveRef.current,
        push: (href) => router.push(href),
      });
    },
    [router]
  );

  usePosNfcBridge(handleCard);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const now = Date.now();
      const next = reduceWedgeKey(bufferRef.current, { key: event.key, now });
      bufferRef.current = next;

      if (!next.committed) return;

      bufferRef.current = createWedgeBuffer();
      event.preventDefault();
      handleCard(next.committed);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCard]);

  return null;
}
