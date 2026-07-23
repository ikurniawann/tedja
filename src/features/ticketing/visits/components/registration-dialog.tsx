"use client";

import { useMemo, useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useTicketingSettings } from "../../masters/queries";
import { useLoketOptions } from "../../products/queries";
import { useRegisterVisit } from "../queries";
import type { PaymentMode } from "../../masters/types";
import {
  CASH_METHOD_LABELS,
  type CashMethod,
  type RegisterVisitBand,
  type RegisterVisitBundle,
} from "../types";

interface BundleUnitDraft extends RegisterVisitBundle {
  key: string;
  ticket_name: string;
  member_labels: string[];
}

interface RegistrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

export function RegistrationDialog({ open, onOpenChange }: RegistrationDialogProps) {
  const optionsQuery = useLoketOptions();
  const settingsQuery = useTicketingSettings();
  // Opsi = varian dari ticket Active yang didistribusi ke POS; paket
  // (Fase P) dijual per unit — lihat bundleUnits
  const options = useMemo(() => optionsQuery.data ?? [], [optionsQuery.data]);
  const singleOptions = useMemo(
    () => options.filter((o) => o.product_kind === "single"),
    [options]
  );
  const bundleOptions = useMemo(
    () => options.filter((o) => o.product_kind === "bundle"),
    [options]
  );

  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState<CashMethod>("cash");
  const [bands, setBands] = useState<RegisterVisitBand[]>([]);
  const [bundleUnits, setBundleUnits] = useState<BundleUnitDraft[]>([]);
  const [tapUid, setTapUid] = useState("");

  const effectiveMode: PaymentMode =
    paymentMode ?? settingsQuery.data?.default_payment_mode ?? "postpaid";
  const defaultLimit = Number(settingsQuery.data?.default_credit_limit ?? 0);
  const defaultVariantId = singleOptions[0]?.variant_id ?? "";

  const reset = () => {
    setContactName("");
    setContactPhone("");
    setPaymentMode(null);
    setDepositAmount("");
    setDepositMethod("cash");
    setBands([]);
    setBundleUnits([]);
    setTapUid("");
  };

  const mutation = useRegisterVisit(() => {
    reset();
    onOpenChange(false);
  });

  const allUids = useMemo(
    () => [
      ...bands.map((b) => b.nfc_uid.toUpperCase()),
      ...bundleUnits.flatMap((u) => u.band_uids.map((x) => x.toUpperCase())),
    ],
    [bands, bundleUnits]
  );

  // Tap berikutnya mengisi unit paket yang belum lengkap dulu (urut),
  // baru menjadi tiket satuan — satu kolom input utk reader NFC/wedge
  const pendingUnitIndex = bundleUnits.findIndex(
    (u) => u.band_uids.length < u.member_labels.length
  );

  const addBundleUnit = (bundleVariantId: string) => {
    const option = bundleOptions.find((o) => o.variant_id === bundleVariantId);
    if (!option) return;
    setBundleUnits((prev) => [
      ...prev,
      {
        key: `${bundleVariantId}-${Date.now()}-${prev.length}`,
        bundle_variant_id: bundleVariantId,
        band_uids: [],
        ticket_name: option.ticket_name,
        member_labels: option.members.flatMap((m) =>
          Array.from({ length: m.qty }, () => m.label)
        ),
      },
    ]);
  };

  const removeBundleUnit = (key: string) => {
    setBundleUnits((prev) => prev.filter((u) => u.key !== key));
  };

  const addBand = () => {
    const uid = tapUid.trim();
    if (!uid) return;
    if (allUids.includes(uid.toUpperCase())) {
      setTapUid("");
      return;
    }
    if (pendingUnitIndex >= 0) {
      setBundleUnits((prev) =>
        prev.map((u, i) =>
          i === pendingUnitIndex ? { ...u, band_uids: [...u.band_uids, uid] } : u
        )
      );
      setTapUid("");
      return;
    }
    if (!defaultVariantId) return;
    setBands((prev) => [...prev, { nfc_uid: uid, variant_id: defaultVariantId }]);
    setTapUid("");
  };

  const setBandVariant = (index: number, variantId: string) => {
    setBands((prev) =>
      prev.map((b, i) => (i === index ? { ...b, variant_id: variantId } : b))
    );
  };

  const removeBand = (index: number) => {
    setBands((prev) => prev.filter((_, i) => i !== index));
  };

  const depositValue = Number(depositAmount) || 0;
  const allUnitsComplete = pendingUnitIndex < 0;
  const canSubmit =
    contactName.trim() !== "" &&
    (bands.length > 0 || bundleUnits.length > 0) &&
    allUnitsComplete &&
    (effectiveMode !== "prepaid" || depositValue > 0) &&
    !mutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    mutation.mutate({
      contact_name: contactName.trim(),
      contact_phone: contactPhone.trim() || null,
      payment_mode: effectiveMode,
      deposit:
        effectiveMode === "prepaid"
          ? { amount: depositValue, method: depositMethod }
          : null,
      bands,
      bundles: bundleUnits.map((u) => ({
        bundle_variant_id: u.bundle_variant_id,
        band_uids: u.band_uids,
      })),
    });
  };

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bands) {
      counts.set(b.variant_id, (counts.get(b.variant_id) ?? 0) + 1);
    }
    const singles = options
      .filter((o) => counts.has(o.variant_id))
      .map((o) => `${counts.get(o.variant_id)} ${o.ticket_name} ${o.variant_name}`);
    const bundleCounts = new Map<string, number>();
    for (const u of bundleUnits) {
      bundleCounts.set(
        u.ticket_name,
        (bundleCounts.get(u.ticket_name) ?? 0) + 1
      );
    }
    const bundles = [...bundleCounts.entries()].map(
      ([name, n]) => `${n} unit ${name}`
    );
    return [...bundles, ...singles].join(" + ");
  }, [bands, bundleUnits, options]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Registrasi Kunjungan Baru</DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="visit_contact">Nama Penanggung Jawab *</Label>
              <Input
                id="visit_contact"
                placeholder="mis. Bpk. Ahmad (rombongan keluarga)"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="visit_phone">No. WhatsApp</Label>
              <Input
                id="visit_phone"
                placeholder="08xxxxxxxxxx"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mode Bayar</Label>
              <Select
                value={effectiveMode}
                onValueChange={(v) => setPaymentMode(v as PaymentMode)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="postpaid">
                    Postpaid — tagihan menumpuk, bayar saat keluar
                  </SelectItem>
                  <SelectItem value="prepaid">
                    Prepaid — top-up saldo sekarang, sisa di-refund
                  </SelectItem>
                </SelectContent>
              </Select>
              {effectiveMode === "postpaid" && defaultLimit > 0 ? (
                <p className="text-xs text-gray-500">
                  Plafon tagihan venue: {formatRp(defaultLimit)}
                </p>
              ) : null}
            </div>
            {effectiveMode === "prepaid" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="deposit_amount">Top-up Awal (Rp) *</Label>
                  <Input
                    id="deposit_amount"
                    type="number"
                    min={0}
                    step={50000}
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Metode</Label>
                  <Select
                    value={depositMethod}
                    onValueChange={(v) => setDepositMethod(v as CashMethod)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CASH_METHOD_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tap_uid">Tap Gelang Satu per Satu *</Label>
              <Input
                id="tap_uid"
                autoFocus
                placeholder="Fokuskan kursor lalu tap gelang di reader"
                value={tapUid}
                onChange={(e) => setTapUid(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBand();
                  }
                }}
                className="font-mono"
              />
              <p className="text-xs text-gray-500">
                {pendingUnitIndex >= 0
                  ? `Tap berikutnya → ${bundleUnits[pendingUnitIndex].ticket_name} · ${
                      bundleUnits[pendingUnitIndex].member_labels[
                        bundleUnits[pendingUnitIndex].band_uids.length
                      ]
                    }`
                  : "Tiap gelang terikat satu tiket — ganti ticket/varian di daftar"}
              </p>
              {!optionsQuery.isLoading && options.length === 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Belum ada ticket Active yang didistribusi ke POS — buat di
                  Master Ticket dulu.
                </p>
              ) : null}
              {bundleOptions.length > 0 ? (
                <Select value="" onValueChange={addBundleUnit}>
                  <SelectTrigger className="h-8 w-full">
                    <SelectValue placeholder="+ Tambah unit paket…" />
                  </SelectTrigger>
                  <SelectContent>
                    {bundleOptions.map((option) => (
                      <SelectItem key={option.variant_id} value={option.variant_id}>
                        {option.ticket_name} ({option.members_per_unit} gelang)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>

            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {bundleUnits.map((unit, unitIndex) => (
                <div
                  key={unit.key}
                  className={`rounded-lg border px-3 py-2 ${
                    unitIndex === pendingUnitIndex
                      ? "border-purple-300 bg-purple-50/50"
                      : "border-gray-200/70"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-purple-700">
                      Paket: {unit.ticket_name} ({unit.band_uids.length}/
                      {unit.member_labels.length} gelang)
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeBundleUnit(unit.key)}
                      className="h-8 w-8 p-0 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {unit.member_labels.map((label, mi) => (
                      <li
                        key={`${unit.key}-${mi}`}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="text-gray-500">{label}</span>
                        <span className="font-mono text-gray-700">
                          {unit.band_uids[mi] ?? "— tap gelang —"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {bands.map((band, index) => (
                <div
                  key={band.nfc_uid}
                  className="flex items-center gap-2 rounded-lg border border-gray-200/70 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700">
                    {band.nfc_uid}
                  </span>
                  <Select
                    value={band.variant_id}
                    onValueChange={(v) => setBandVariant(index, v)}
                  >
                    <SelectTrigger className="h-8 w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {singleOptions.map((option) => (
                        <SelectItem key={option.variant_id} value={option.variant_id}>
                          {option.ticket_name} — {option.variant_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeBand(index)}
                    className="h-8 w-8 p-0 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {bands.length === 0 && bundleUnits.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-xs text-gray-400">
                  Belum ada gelang di-tap
                </p>
              ) : null}
            </div>
            {allUids.length > 0 ? (
              <Badge className="border-0 bg-pink-100 font-normal text-pink-700">
                {allUids.length} gelang: {typeCounts}
              </Badge>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {mutation.isPending ? "Mendaftarkan…" : "Daftarkan Kunjungan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
