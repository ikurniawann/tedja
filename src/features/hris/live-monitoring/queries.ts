"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchLiveSessions } from "./api";

export const liveMonitoringQueryKeys = {
  sessions: () => ["hris", "live-monitoring", "sessions"] as const,
};

/** Daftar sesi berjalan — dipoll supaya thumbnail selalu segar. */
export const useLiveSessions = () =>
  useQuery({
    queryKey: liveMonitoringQueryKeys.sessions(),
    queryFn: fetchLiveSessions,
    refetchInterval: 8_000,
  });
