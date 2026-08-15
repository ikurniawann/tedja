"use client";

import { useEffect, useMemo, useState } from "react";
import { Gift, Loader2, Package, Percent, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TableRow } from "@/components/ui/table";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { formatIdrInput, parseIdrDigits } from "@/components/pos/idr-input";
import { OFFER_TYPE_LABELS } from "@/lib/promo/offer-rules";
import { listPosCatalogProducts } from "@/features/pos/products/api";
import type { PosCatalogProduct } from "@/features/pos/products/types";
import {
  useCreateOfferRule,
  useDeleteOfferRule,
  useOfferRules,
  useUpdateOfferRule,
} from "../queries";
import type {
  BxgyGetMode,
  OfferDiscountType,
  OfferItemRole,
  OfferRule,
  OfferRulePayload,
  OfferType,
  VolumeBasis,
} from "../types";

function numberFromApi(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  // API/DB numeric sering "1.000" (desimal), bukan format ribuan IDR.
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n);
  return rounded > 0 ? String(rounded) : "";
}

type DraftItem = {
  key: string;
  role: OfferItemRole;
  product_id: string;
  qty: string;
};

type FormState = {
  name: string;
  description: string;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
  bundle_price: string;
  buy_qty: string;
  get_qty: string;
  get_mode: BxgyGetMode;
  volume_basis: VolumeBasis;
  volume_min: string;
  discount_type: OfferDiscountType;
  discount_value: string;
  items: DraftItem[];
};

function emptyForm(type: OfferType): FormState {
  return {
    name: "",
    description: "",
    valid_from: "",
    valid_until: "",
    is_active: true,
    bundle_price: "",
    buy_qty: type === "bxgy" ? "1" : "",
    get_qty: type === "bxgy" ? "1" : "",
    get_mode: "same_as_buy",
    volume_basis: "qty",
    volume_min: "",
    discount_type: "percent",
    discount_value: "",
    items: [],
  };
}

function fromRule(rule: OfferRule): FormState {
  return {
    name: rule.name,
    description: rule.description ?? "",
    valid_from: rule.valid_from ?? "",
    valid_until: rule.valid_until ?? "",
    is_active: rule.is_active,
    bundle_price: numberFromApi(rule.bundle_price),
    buy_qty: numberFromApi(rule.buy_qty),
    get_qty: numberFromApi(rule.get_qty),
    get_mode: rule.get_mode ?? "same_as_buy",
    volume_basis: rule.volume_basis ?? "qty",
    volume_min: numberFromApi(rule.volume_min),
    discount_type: rule.discount_type ?? "percent",
    discount_value: numberFromApi(rule.discount_value),
    items: rule.items.map((item, index) => ({
      key: item.id ?? `${item.product_id}-${index}`,
      role: item.role,
      product_id: item.product_id,
      qty: numberFromApi(item.qty) || "1",
    })),
  };
}

function formatWindow(rule: OfferRule) {
  if (!rule.valid_from && !rule.valid_until) return "Tanpa batas";
  return `${rule.valid_from ?? "…"} s/d ${rule.valid_until ?? "…"}`;
}

function summarize(rule: OfferRule) {
  if (rule.offer_type === "bundle") {
    const comps = rule.items
      .filter((i) => i.role === "component")
      .map((i) => `${i.product_name ?? "Produk"}×${Number(i.qty)}`)
      .join(" + ");
    return `${comps || "—"} → Rp ${Number(rule.bundle_price || 0).toLocaleString("id-ID")}`;
  }
  if (rule.offer_type === "bxgy") {
    return `Beli ${rule.buy_qty} gratis ${rule.get_qty} (${
      rule.get_mode === "specific_products" ? "item spesifik" : "item sama"
    })`;
  }
  const basis = rule.volume_basis === "spend" ? "min belanja" : "min qty";
  const disc =
    rule.discount_type === "percent"
      ? `${Number(rule.discount_value)}%`
      : `Rp ${Number(rule.discount_value || 0).toLocaleString("id-ID")}`;
  return `${basis} ${Number(rule.volume_min || 0).toLocaleString("id-ID")} → ${disc}`;
}

const META: Record<
  OfferType,
  { title: string; description: string; note: string }
> = {
  bundle: {
    title: "Bundling",
    description: "Paket produk A+B dengan harga khusus.",
    note: "Stok & resep tetap mengikuti produk komponen (bukan stok bundle terpisah).",
  },
  bxgy: {
    title: "Buy X Get Y",
    description: "Beli X gratis Y — item sama atau produk gratis spesifik.",
    note: "Contoh: beli 1 gratis 1, beli 3 gratis 1, beli 1 gratis item A/B.",
  },
  volume: {
    title: "Diskon Volume",
    description: "Diskon setelah minimum qty atau minimum belanja.",
    note: "Contoh: beli 5 diskon 3% / Rp3.000. Kosongkan daftar produk = semua item.",
  },
};

export function OfferRulesPage({ offerType }: { offerType: OfferType }) {
  const meta = META[offerType];
  const listQuery = useOfferRules(offerType);
  const createMutation = useCreateOfferRule(offerType);
  const updateMutation = useUpdateOfferRule(offerType);
  const deleteMutation = useDeleteOfferRule(offerType);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OfferRule | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(offerType));
  const [products, setProducts] = useState<PosCatalogProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProductsLoading(true);
    listPosCatalogProducts()
      .then((rows) => {
        if (!cancelled) setProducts(rows.filter((p) => p.status === "active"));
      })
      .catch(() => {
        if (!cancelled) toast.error("Gagal memuat daftar produk");
      })
      .finally(() => {
        if (!cancelled) setProductsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const productOptions = useMemo(
    () =>
      products.map((p) => ({
        id: p.id,
        label: `${p.name}${p.price ? ` · Rp ${p.price.toLocaleString("id-ID")}` : ""}`,
      })),
    [products]
  );

  const saving = createMutation.isPending || updateMutation.isPending;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(offerType));
    setOpen(true);
  }

  function openEdit(rule: OfferRule) {
    setEditing(rule);
    setForm(fromRule(rule));
    setOpen(true);
  }

  function patchForm(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function addItem(role: OfferItemRole) {
    setForm((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          key: `${role}-${Date.now()}-${Math.random()}`,
          role,
          product_id: "",
          qty: "1",
        },
      ],
    }));
  }

  function patchItem(key: string, patch: Partial<DraftItem>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.key === key ? { ...item, ...patch } : item
      ),
    }));
  }

  function removeItem(key: string) {
    setForm((current) => ({
      ...current,
      items: current.items.filter((item) => item.key !== key),
    }));
  }

  function buildPayload(): OfferRulePayload {
    let draftItems = form.items.filter((item) => item.product_id);
    if (offerType === "bxgy" && form.get_mode === "same_as_buy") {
      draftItems = draftItems.filter((item) => item.role !== "get");
    }
    if (offerType === "bundle") {
      draftItems = draftItems.filter((item) => item.role === "component");
    }
    if (offerType === "volume") {
      draftItems = draftItems.filter((item) => item.role === "eligible");
    }
    if (offerType === "bxgy") {
      draftItems = draftItems.filter(
        (item) => item.role === "buy" || item.role === "get"
      );
    }

    const items = draftItems.map((item, index) => ({
      role: item.role,
      product_id: item.product_id,
      qty: parseIdrDigits(item.qty) || 1,
      sort_order: index,
    }));

    return {
      offer_type: offerType,
      name: form.name.trim(),
      description: form.description.trim() || null,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      is_active: form.is_active,
      bundle_price:
        offerType === "bundle" ? parseIdrDigits(form.bundle_price) || 0 : null,
      buy_qty: offerType === "bxgy" ? parseIdrDigits(form.buy_qty) || 0 : null,
      get_qty: offerType === "bxgy" ? parseIdrDigits(form.get_qty) || 0 : null,
      get_mode: offerType === "bxgy" ? form.get_mode : null,
      volume_basis: offerType === "volume" ? form.volume_basis : null,
      volume_min:
        offerType === "volume" ? parseIdrDigits(form.volume_min) || 0 : null,
      discount_type: offerType === "volume" ? form.discount_type : null,
      discount_value:
        offerType === "volume" ? parseIdrDigits(form.discount_value) || 0 : null,
      items,
    };
  }

  async function handleSave() {
    const payload = buildPayload();
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, payload });
        toast.success("Aturan diperbarui");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("Aturan dibuat");
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    }
  }

  async function handleDelete(rule: OfferRule) {
    if (!window.confirm(`Hapus aturan “${rule.name}”?`)) return;
    try {
      await deleteMutation.mutateAsync(rule.id);
      toast.success("Aturan dihapus");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  const rows = listQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-foreground">{meta.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
        <p className="mt-1 text-xs text-muted-foreground">{meta.note}</p>
      </div>

      <PurchasingListSection
        icon={
          offerType === "bundle"
            ? Package
            : offerType === "bxgy"
              ? Gift
              : Percent
        }
        title={`Daftar ${OFFER_TYPE_LABELS[offerType]}`}
        description="Berlaku sesuai periode yang ditentukan pada setiap aturan."
        toolbar={
          <Button type="button" onClick={openCreate} className="bg-primary hover:bg-primary/90">
            <Plus className="mr-1.5 h-4 w-4" />
            Tambah
          </Button>
        }
      >
        {listQuery.isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Belum ada aturan. Klik Tambah untuk membuat.
          </p>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-muted-foreground">
                  <th className="py-3 font-medium">Nama</th>
                  <th className="py-3 font-medium">Aturan</th>
                  <th className="py-3 font-medium">Periode</th>
                  <th className="py-3 font-medium">Status</th>
                  <th className="py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((rule) => (
                  <TableRow key={rule.id} className="border-b border-gray-200/70">
                    <td className="py-3 font-medium text-foreground">{rule.name}</td>
                    <td className="py-3 text-muted-foreground">{summarize(rule)}</td>
                    <td className="py-3 text-muted-foreground">{formatWindow(rule)}</td>
                    <td className="py-3">
                      <Badge variant={rule.is_active ? "default" : "secondary"}>
                        {rule.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(rule)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-red-200 text-red-600 hover:bg-red-50"
                          disabled={deleteMutation.isPending}
                          onClick={() => void handleDelete(rule)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
        <DialogPanel size="lg">
          <DialogPanelHeader>
            <DialogPanelTitle>
              {editing ? "Edit" : "Tambah"} {meta.title}
            </DialogPanelTitle>
            <DialogPanelDescription>{meta.note}</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 sm:col-span-2">
                <Label>Nama</Label>
                <Input
                  value={form.name}
                  onChange={(e) => patchForm({ name: e.target.value })}
                  className="border-gray-200/80"
                />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <Label>Deskripsi</Label>
                <Input
                  value={form.description}
                  onChange={(e) => patchForm({ description: e.target.value })}
                  className="border-gray-200/80"
                />
              </label>
              <label className="space-y-1.5">
                <Label>Berlaku dari</Label>
                <Input
                  type="date"
                  value={form.valid_from}
                  onChange={(e) => patchForm({ valid_from: e.target.value })}
                  className="border-gray-200/80"
                />
              </label>
              <label className="space-y-1.5">
                <Label>Berlaku sampai</Label>
                <Input
                  type="date"
                  value={form.valid_until}
                  onChange={(e) => patchForm({ valid_until: e.target.value })}
                  className="border-gray-200/80"
                />
              </label>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-gray-200/70 px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">Aktif</div>
                <div className="text-xs text-muted-foreground">
                  Nonaktif = tidak dipakai di kasir POS
                </div>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(checked) => patchForm({ is_active: checked })}
              />
            </div>

            {offerType === "bundle" && (
              <div className="space-y-3 rounded-xl border border-gray-200/70 p-3">
                <label className="space-y-1.5 block">
                  <Label>Harga bundling (Rp)</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={formatIdrInput(form.bundle_price)}
                    onChange={(e) =>
                      patchForm({
                        bundle_price: String(parseIdrDigits(e.target.value) || ""),
                      })
                    }
                    className="border-gray-200/80 tabular-nums"
                  />
                </label>
                <ItemEditor
                  title="Komponen produk"
                  role="component"
                  items={form.items.filter((i) => i.role === "component")}
                  productOptions={productOptions}
                  productsLoading={productsLoading}
                  showQty
                  onAdd={() => addItem("component")}
                  onPatch={patchItem}
                  onRemove={removeItem}
                />
              </div>
            )}

            {offerType === "bxgy" && (
              <div className="space-y-3 rounded-xl border border-gray-200/70 p-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1.5">
                    <Label>Qty beli (X)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="1"
                      value={formatIdrInput(form.buy_qty)}
                      onChange={(e) =>
                        patchForm({
                          buy_qty: String(parseIdrDigits(e.target.value) || ""),
                        })
                      }
                      className="border-gray-200/80 tabular-nums"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <Label>Qty gratis (Y)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="1"
                      value={formatIdrInput(form.get_qty)}
                      onChange={(e) =>
                        patchForm({
                          get_qty: String(parseIdrDigits(e.target.value) || ""),
                        })
                      }
                      className="border-gray-200/80 tabular-nums"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <Label>Gratis berupa</Label>
                    <Select
                      value={form.get_mode}
                      onValueChange={(value) =>
                        patchForm({ get_mode: value as BxgyGetMode })
                      }
                    >
                      <SelectTrigger className="border-gray-200/80">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="same_as_buy">Item yang sama</SelectItem>
                        <SelectItem value="specific_products">
                          Produk spesifik
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                <ItemEditor
                  title="Produk yang dibeli"
                  role="buy"
                  items={form.items.filter((i) => i.role === "buy")}
                  productOptions={productOptions}
                  productsLoading={productsLoading}
                  onAdd={() => addItem("buy")}
                  onPatch={patchItem}
                  onRemove={removeItem}
                />
                {form.get_mode === "specific_products" && (
                  <ItemEditor
                    title="Produk gratis"
                    role="get"
                    items={form.items.filter((i) => i.role === "get")}
                    productOptions={productOptions}
                    productsLoading={productsLoading}
                    onAdd={() => addItem("get")}
                    onPatch={patchItem}
                    onRemove={removeItem}
                  />
                )}
              </div>
            )}

            {offerType === "volume" && (
              <div className="space-y-3 rounded-xl border border-gray-200/70 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <Label>Basis minimum</Label>
                    <Select
                      value={form.volume_basis}
                      onValueChange={(value) =>
                        patchForm({ volume_basis: value as VolumeBasis })
                      }
                    >
                      <SelectTrigger className="border-gray-200/80">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qty">Minimum qty (beli N)</SelectItem>
                        <SelectItem value="spend">Minimum belanja (Rp)</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-1.5">
                    <Label>
                      {form.volume_basis === "spend"
                        ? "Minimum belanja (Rp)"
                        : "Minimum qty"}
                    </Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formatIdrInput(form.volume_min)}
                      onChange={(e) =>
                        patchForm({
                          volume_min: String(parseIdrDigits(e.target.value) || ""),
                        })
                      }
                      className="border-gray-200/80 tabular-nums"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <Label>Tipe diskon</Label>
                    <Select
                      value={form.discount_type}
                      onValueChange={(value) =>
                        patchForm({ discount_type: value as OfferDiscountType })
                      }
                    >
                      <SelectTrigger className="border-gray-200/80">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">Persen (%)</SelectItem>
                        <SelectItem value="fixed">Nominal (Rp)</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-1.5">
                    <Label>
                      {form.discount_type === "percent"
                        ? "Nilai diskon (%)"
                        : "Nilai diskon (Rp)"}
                    </Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formatIdrInput(form.discount_value)}
                      onChange={(e) =>
                        patchForm({
                          discount_value: String(
                            parseIdrDigits(e.target.value) || ""
                          ),
                        })
                      }
                      className="border-gray-200/80 tabular-nums"
                    />
                  </label>
                </div>
                <ItemEditor
                  title="Produk eligible (opsional)"
                  role="eligible"
                  items={form.items.filter((i) => i.role === "eligible")}
                  productOptions={productOptions}
                  productsLoading={productsLoading}
                  onAdd={() => addItem("eligible")}
                  onPatch={patchItem}
                  onRemove={removeItem}
                />
              </div>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="bg-primary hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Menyimpan…
                </>
              ) : (
                "Simpan"
              )}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}

function ItemEditor({
  title,
  items,
  productOptions,
  productsLoading,
  showQty = false,
  onAdd,
  onPatch,
  onRemove,
}: {
  title: string;
  role: OfferItemRole;
  items: DraftItem[];
  productOptions: Array<{ id: string; label: string }>;
  productsLoading: boolean;
  showQty?: boolean;
  onAdd: () => void;
  onPatch: (key: string, patch: Partial<DraftItem>) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Produk
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada produk.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.key} className="flex flex-wrap items-center gap-2">
              <Select
                value={item.product_id || "__none__"}
                onValueChange={(value) =>
                  onPatch(item.key, {
                    product_id: value === "__none__" ? "" : value,
                  })
                }
              >
                <SelectTrigger className="min-w-[220px] flex-1 border-gray-200/80">
                  <SelectValue
                    placeholder={productsLoading ? "Memuat…" : "Pilih produk"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" disabled>
                    {productsLoading ? "Memuat…" : "Pilih produk"}
                  </SelectItem>
                  {productOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showQty ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={formatIdrInput(item.qty)}
                    onChange={(e) =>
                      onPatch(item.key, {
                        qty: String(parseIdrDigits(e.target.value) || ""),
                      })
                    }
                    className="w-20 border-gray-200/80 tabular-nums"
                    aria-label="Qty pcs"
                  />
                  <span className="text-xs text-muted-foreground">pcs</span>
                </div>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-red-200 text-red-600"
                onClick={() => onRemove(item.key)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
