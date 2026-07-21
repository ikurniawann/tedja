"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchBands,
  fetchChannels,
  fetchSettings,
  registerBand,
  updateBand,
  updateChannel,
  updateSettings,
} from "./api";
import type { BandFilters, SettingsFormValues, TicketBand } from "./types";

export const ticketingQueryKeys = {
  all: ["ticketing"] as const,
  settings: ["ticketing", "settings"] as const,
  channels: ["ticketing", "channels"] as const,
  bands: (filters: BandFilters) => ["ticketing", "bands", filters] as const,
  bandsAll: ["ticketing", "bands"] as const,
};

// Settings dipanggil pertama — GET-nya sekaligus bootstrap kanal default
// venue (walk-in/website).
export const useTicketingSettings = () =>
  useQuery({ queryKey: ticketingQueryKeys.settings, queryFn: fetchSettings });

export const useChannels = () =>
  useQuery({ queryKey: ticketingQueryKeys.channels, queryFn: fetchChannels });

export const useBands = (filters: BandFilters) =>
  useQuery({
    queryKey: ticketingQueryKeys.bands(filters),
    queryFn: () => fetchBands(filters),
  });

function useInvalidatingMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<unknown>,
  successMessage: string,
  keys: readonly (readonly string[])[],
  onSuccess?: () => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      toast.success(successMessage);
      for (const key of keys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export const useUpdateSettings = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    (values: SettingsFormValues) => updateSettings(values),
    "Pengaturan tersimpan",
    [ticketingQueryKeys.settings],
    onSuccess
  );

export const useUpdateChannel = () =>
  useInvalidatingMutation(
    ({ id, values }: { id: string; values: { name?: string; is_active?: boolean } }) =>
      updateChannel(id, values),
    "Kanal diperbarui",
    [ticketingQueryKeys.channels]
  );

export const useRegisterBand = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    (values: { nfc_uid: string; label: string | null }) => registerBand(values),
    "Gelang terdaftar",
    [ticketingQueryKeys.bandsAll],
    onSuccess
  );

export const useUpdateBand = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: { label?: string | null; status?: TicketBand["status"] };
    }) => updateBand(id, values),
    "Gelang diperbarui",
    [ticketingQueryKeys.bandsAll],
    onSuccess
  );
