"use client";

import { useSyncExternalStore } from "react";
import { isHandheldClient } from "@/lib/pos/thermal-serial";

function subscribe(_onStoreChange: () => void): () => void {
  return () => {};
}

function getSnapshot(): boolean {
  return isHandheldClient();
}

function getServerSnapshot(): boolean {
  return false;
}

/** Hydration-safe: SSR false, then iPad/Android UA after mount. */
export function useHandheldClient(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
