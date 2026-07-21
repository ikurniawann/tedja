"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createSeason,
  createTicketType,
  deleteSeason,
  fetchBands,
  fetchChannels,
  fetchPriceMatrix,
  fetchSeasons,
  fetchSettings,
  fetchTicketTypes,
  registerBand,
  savePriceMatrix,
  updateBand,
  updateChannel,
  updateSeason,
  updateSettings,
  updateTicketType,
} from "./api";
import type {
  BandFilters,
  PriceEntry,
  SeasonFormValues,
  SettingsFormValues,
  TicketBand,
  TicketTypeFormValues,
} from "./types";

export const ticketingQueryKeys = {
  all: ["ticketing"] as const,
  settings: ["ticketing", "settings"] as const,
  types: ["ticketing", "types"] as const,
  seasons: ["ticketing", "seasons"] as const,
  channels: ["ticketing", "channels"] as const,
  prices: ["ticketing", "prices"] as const,
  bands: (filters: BandFilters) => ["ticketing", "bands", filters] as const,
  bandsAll: ["ticketing", "bands"] as const,
};

// Settings dipanggil pertama — GET-nya sekaligus bootstrap master default
// venue (adult/child + walk-in/website), jadi query lain di-refresh setelahnya.
export const useTicketingSettings = () =>
  useQuery({ queryKey: ticketingQueryKeys.settings, queryFn: fetchSettings });

export const useTicketTypes = () =>
  useQuery({ queryKey: ticketingQueryKeys.types, queryFn: fetchTicketTypes });

export const useSeasons = () =>
  useQuery({ queryKey: ticketingQueryKeys.seasons, queryFn: fetchSeasons });

export const useChannels = () =>
  useQuery({ queryKey: ticketingQueryKeys.channels, queryFn: fetchChannels });

export const usePriceMatrix = () =>
  useQuery({ queryKey: ticketingQueryKeys.prices, queryFn: fetchPriceMatrix });

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

export const useCreateTicketType = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    (values: TicketTypeFormValues) => createTicketType(values),
    "Jenis tiket dibuat",
    [ticketingQueryKeys.types, ticketingQueryKeys.prices],
    onSuccess
  );

export const useUpdateTicketType = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: Partial<TicketTypeFormValues> & { is_active?: boolean };
    }) => updateTicketType(id, values),
    "Jenis tiket diperbarui",
    [ticketingQueryKeys.types, ticketingQueryKeys.prices],
    onSuccess
  );

export const useCreateSeason = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    (values: SeasonFormValues) => createSeason(values),
    "Musim ditambahkan",
    [ticketingQueryKeys.seasons],
    onSuccess
  );

export const useUpdateSeason = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    ({
      id,
      values,
    }: {
      id: string;
      values: Partial<SeasonFormValues> & { is_active?: boolean };
    }) => updateSeason(id, values),
    "Musim diperbarui",
    [ticketingQueryKeys.seasons],
    onSuccess
  );

export const useDeleteSeason = () =>
  useInvalidatingMutation(
    (id: string) => deleteSeason(id),
    "Musim dihapus",
    [ticketingQueryKeys.seasons]
  );

export const useUpdateChannel = () =>
  useInvalidatingMutation(
    ({ id, values }: { id: string; values: { name?: string; is_active?: boolean } }) =>
      updateChannel(id, values),
    "Kanal diperbarui",
    [ticketingQueryKeys.channels, ticketingQueryKeys.prices]
  );

export const useSavePriceMatrix = (onSuccess?: () => void) =>
  useInvalidatingMutation(
    (entries: PriceEntry[]) => savePriceMatrix(entries),
    "Matriks harga tersimpan",
    [ticketingQueryKeys.prices],
    onSuccess
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
