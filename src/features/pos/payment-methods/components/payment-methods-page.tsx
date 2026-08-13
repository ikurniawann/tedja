"use client";

import { useMemo, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { TableRow } from "@/components/ui/table";
import type { PosPaymentMethod } from "@/lib/pos/payment-methods";
import { usePaymentMethods, useUpdatePaymentMethod } from "../queries";

export function PaymentMethodsPage() {
  const listQuery = usePaymentMethods(false);
  const updateMutation = useUpdatePaymentMethod();
  const [drafts, setDrafts] = useState<
    Record<string, { name: string; description: string; sort_order: string }>
  >({});

  const methods = listQuery.data ?? [];

  const rows = useMemo(() => {
    return methods.map((method) => {
      const draft = drafts[method.code];
      return {
        ...method,
        name: draft?.name ?? method.name,
        description: draft?.description ?? method.description,
        sort_order_text:
          draft?.sort_order ?? String(method.sort_order),
      };
    });
  }, [methods, drafts]);

  function setDraft(
    code: string,
    patch: Partial<{ name: string; description: string; sort_order: string }>
  ) {
    setDrafts((current) => {
      const base = current[code] ?? {
        name: methods.find((m) => m.code === code)?.name ?? "",
        description: methods.find((m) => m.code === code)?.description ?? "",
        sort_order: String(methods.find((m) => m.code === code)?.sort_order ?? 0),
      };
      return { ...current, [code]: { ...base, ...patch } };
    });
  }

  function isDirty(method: PosPaymentMethod) {
    const draft = drafts[method.code];
    if (!draft) return false;
    return (
      draft.name !== method.name ||
      draft.description !== method.description ||
      Number(draft.sort_order) !== method.sort_order
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-foreground">Metode Bayar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aktifkan, urutkan, dan ubah label metode di kasir. Handler ARK / NFC /
          Gift Card tetap terikat skema existing.
        </p>
      </div>

      <PurchasingListSection
        icon={CreditCard}
        title="Master metode pembayaran"
        description="Kode & handler tidak diubah dari sini — hanya tampilan dan status aktif."
      >
        {listQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Memuat metode…</p>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Belum ada data metode bayar.
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground hover:bg-muted/40">
                  <th className="px-4 py-3 text-left font-semibold">Aktif</th>
                  <th className="px-4 py-3 text-left font-semibold">Kode</th>
                  <th className="px-4 py-3 text-left font-semibold">Nama</th>
                  <th className="px-4 py-3 text-left font-semibold">Deskripsi</th>
                  <th className="px-4 py-3 text-left font-semibold">Handler</th>
                  <th className="px-4 py-3 text-right font-semibold">Urutan</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {rows.map((row) => {
                  const original = methods.find((m) => m.code === row.code)!;
                  const dirty = isDirty(original);
                  const busy =
                    updateMutation.isPending &&
                    updateMutation.variables?.code === row.code;
                  return (
                    <TableRow key={row.code} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Switch
                          checked={original.is_active}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            updateMutation.mutate({
                              code: row.code,
                              is_active: checked,
                            })
                          }
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        {row.code}
                      </td>
                      <td className="px-4 py-3">
                        <Input
                          value={row.name}
                          disabled={busy}
                          onChange={(e) =>
                            setDraft(row.code, { name: e.target.value })
                          }
                          className="h-9 border-gray-200/80"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Input
                          value={row.description}
                          disabled={busy}
                          onChange={(e) =>
                            setDraft(row.code, { description: e.target.value })
                          }
                          className="h-9 border-gray-200/80"
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {row.handler}
                      </td>
                      <td className="px-4 py-3">
                        <Input
                          type="number"
                          min={0}
                          value={row.sort_order_text}
                          disabled={busy}
                          onChange={(e) =>
                            setDraft(row.code, {
                              sort_order: e.target.value.replace(/\D/g, ""),
                            })
                          }
                          className="ml-auto h-9 w-20 border-gray-200/80 text-right"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            className="h-8"
                            disabled={!dirty || busy || row.name.trim().length < 2}
                            onClick={() =>
                              updateMutation.mutate(
                                {
                                  code: row.code,
                                  name: row.name.trim(),
                                  description: row.description.trim(),
                                  sort_order: Number(row.sort_order_text) || 0,
                                },
                                {
                                  onSuccess: () =>
                                    setDrafts((current) => {
                                      const next = { ...current };
                                      delete next[row.code];
                                      return next;
                                    }),
                                }
                              )
                            }
                          >
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Simpan"
                            )}
                          </Button>
                        </div>
                      </td>
                    </TableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>
    </div>
  );
}
