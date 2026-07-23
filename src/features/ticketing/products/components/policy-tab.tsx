"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateProduct } from "../queries";
import type { ReEntryPolicy } from "../../masters/types";
import type { TicketProductDetail } from "../types";

export function PolicyTab({ detail }: { detail: TicketProductDetail }) {
  const [policy, setPolicy] = useState<ReEntryPolicy>(
    detail.product.re_entry_policy
  );
  const updateMutation = useUpdateProduct();

  return (
    <div className="max-w-xl space-y-5">
      <div className="space-y-1.5">
        <Label>Kebijakan Re-entry (tap gate ulang)</Label>
        <Select value={policy} onValueChange={(v) => setPolicy(v as ReEntryPolicy)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sekali-masuk">
              Sekali masuk — tap kedua ditolak
            </SelectItem>
            <SelectItem value="bebas-keluar-masuk">
              Bebas keluar-masuk — tap ulang tidak men-charge
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500">
          Berlaku per ticket ini selama kunjungan masih terbuka. Plafon
          postpaid & default mode bayar tetap diatur per venue di Pengaturan
          Tiket (melekat ke tab kunjungan, bukan produk).
        </p>
      </div>

      <Button
        onClick={() =>
          updateMutation.mutate({
            id: detail.product.id,
            values: { re_entry_policy: policy },
          })
        }
        disabled={updateMutation.isPending}
      >
        {updateMutation.isPending ? "Menyimpan…" : "Simpan Kebijakan"}
      </Button>
    </div>
  );
}
