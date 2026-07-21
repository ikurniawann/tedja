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
import { CASH_METHOD_LABELS, type CashMethod, type RegisterVisitBand } from "../types";

interface RegistrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

export function RegistrationDialog({ open, onOpenChange }: RegistrationDialogProps) {
  const optionsQuery = useLoketOptions();
  const settingsQuery = useTicketingSettings();
  // Opsi = varian dari ticket Active yang didistribusi ke POS
  const options = useMemo(() => optionsQuery.data ?? [], [optionsQuery.data]);

  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState<CashMethod>("cash");
  const [bands, setBands] = useState<RegisterVisitBand[]>([]);
  const [tapUid, setTapUid] = useState("");

  const effectiveMode: PaymentMode =
    paymentMode ?? settingsQuery.data?.default_payment_mode ?? "postpaid";
  const defaultLimit = Number(settingsQuery.data?.default_credit_limit ?? 0);
  const defaultVariantId = options[0]?.variant_id ?? "";

  const reset = () => {
    setContactName("");
    setContactPhone("");
    setPaymentMode(null);
    setDepositAmount("");
    setDepositMethod("cash");
    setBands([]);
    setTapUid("");
  };

  const mutation = useRegisterVisit(() => {
    reset();
    onOpenChange(false);
  });

  const addBand = () => {
    const uid = tapUid.trim();
    if (!uid || !defaultVariantId) return;
    if (bands.some((b) => b.nfc_uid.toUpperCase() === uid.toUpperCase())) {
      setTapUid("");
      return;
    }
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
  const canSubmit =
    contactName.trim() !== "" &&
    bands.length > 0 &&
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
    });
  };

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bands) {
      counts.set(b.variant_id, (counts.get(b.variant_id) ?? 0) + 1);
    }
    return options
      .filter((o) => counts.has(o.variant_id))
      .map((o) => `${counts.get(o.variant_id)} ${o.ticket_name} ${o.variant_name}`)
      .join(" + ");
  }, [bands, options]);

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
                Tiap gelang terikat satu tiket — ganti ticket/varian di daftar
              </p>
              {!optionsQuery.isLoading && options.length === 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Belum ada ticket Active yang didistribusi ke POS — buat di
                  Master Ticket dulu.
                </p>
              ) : null}
            </div>

            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
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
                      {options.map((option) => (
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
              {bands.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-xs text-gray-400">
                  Belum ada gelang di-tap
                </p>
              ) : null}
            </div>
            {bands.length > 0 ? (
              <Badge className="border-0 bg-pink-100 font-normal text-pink-700">
                {bands.length} gelang: {typeCounts}
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
