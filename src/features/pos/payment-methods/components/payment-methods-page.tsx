"use client";

import { useMemo, useState } from "react";
import { CreditCard, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { TableRow } from "@/components/ui/table";
import type { PosPaymentMethod } from "@/lib/pos/payment-methods";
import {
  useCreatePaymentMethod,
  useDeletePaymentMethod,
  usePaymentMethods,
  useUpdatePaymentMethod,
} from "../queries";
import { PROTECTED_PAYMENT_METHOD_CODES } from "@/lib/pos/payment-methods";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";

export function PaymentMethodsPage() {
  const listQuery = usePaymentMethods(false);
  const updateMutation = useUpdatePaymentMethod();
  const createMutation = useCreatePaymentMethod();
  const deleteMutation = useDeletePaymentMethod();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
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
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200/70 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Metode Bayar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aktifkan, urutkan, ubah label, atau tambah metode baru (transfer bank,
            EDC, e-wallet). Metode bawaan ARK / NFC / Gift Card tetap terikat
            alur khususnya.
          </p>
        </div>
        <Button type="button" onClick={() => setShowAdd(true)} className="bg-primary hover:bg-primary/90">
          <Plus className="mr-2 h-4 w-4" />
          Tambah Metode
        </Button>
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
                        <div className="flex justify-end gap-1.5">
                          {!PROTECTED_PAYMENT_METHOD_CODES.has(row.code) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 border-red-200/80 text-red-600 hover:bg-red-50"
                              title="Hapus metode kustom"
                              disabled={busy || deleteMutation.isPending}
                              onClick={() => {
                                if (window.confirm(`Hapus metode "${row.name}"?`)) {
                                  deleteMutation.mutate(row.code);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
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

      <Dialog open={showAdd} onOpenChange={(open) => !open && setShowAdd(false)}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Tambah Metode Bayar</DialogPanelTitle>
            <DialogPanelDescription>
              Metode kustom tampil di kasir sebagai pembayaran non-tunai lunas
              penuh (tanpa alur khusus). Kode dibuat otomatis dari nama.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nama metode</label>
              <Input
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                placeholder="cth: Transfer BCA / EDC Mandiri / GoPay"
                className="border-gray-200/80"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Deskripsi (opsional)</label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="cth: Transfer ke rekening BCA 123456"
                className="border-gray-200/80"
              />
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" className="border-border" onClick={() => setShowAdd(false)}>
              Batal
            </Button>
            <Button
              type="button"
              className="bg-primary hover:bg-primary/90"
              disabled={newName.trim().length < 2 || createMutation.isPending}
              onClick={() =>
                createMutation.mutate(
                  { name: newName.trim(), description: newDescription.trim() || undefined },
                  {
                    onSuccess: () => {
                      setShowAdd(false);
                      setNewName("");
                      setNewDescription("");
                    },
                  }
                )
              }
            >
              {createMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Tambah
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
