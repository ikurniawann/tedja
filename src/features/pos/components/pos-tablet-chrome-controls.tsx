"use client";

import { useCallback, useEffect, useState } from "react";
import { Expand, Minimize2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  /** Compact toolbar style for cashier header */
  className?: string;
};

/**
 * Browser Fullscreen API + hint for Add to Home Screen (PWA manifest-pos).
 */
export function PosTabletChromeControls({ className }: Props) {
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);

  useEffect(() => {
    function sync() {
      setIsBrowserFullscreen(Boolean(document.fullscreenElement));
    }
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
      toast.error(
        "Browser menolak layar penuh. Coba dari tombol di halaman (bukan otomatis), atau gunakan Add to Home Screen."
      );
    }
  }, []);

  const showInstallHint = useCallback(() => {
    toast.message("Pasang sebagai app tablet", {
      description:
        "Chrome/Edge: menu ⋮ → Install app / Add to Home screen. Safari iPad: Share → Add to Home Screen. Buka ikon POS Kasir agar tanpa address bar.",
      duration: 10_000,
    });
  }, []);

  return (
    <div className={className ?? "flex flex-wrap items-center gap-2"}>
      <Button
        type="button"
        variant="outline"
        className="border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
        onClick={() => void toggleBrowserFullscreen()}
        title="Layar penuh browser (sembunyikan address bar)"
      >
        {isBrowserFullscreen ? (
          <>
            <Minimize2 className="mr-2 h-4 w-4" />
            Keluar layar penuh
          </>
        ) : (
          <>
            <Expand className="mr-2 h-4 w-4" />
            Layar penuh
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
        onClick={showInstallHint}
        title="Cara pasang POS ke Home Screen tablet"
      >
        <Smartphone className="mr-2 h-4 w-4" />
        Pasang ke tablet
      </Button>
    </div>
  );
}
