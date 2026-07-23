"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { GeneralPOForm } from "@/components/purchasing/general-po-form";
import { GENERAL_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useApprovedGeneralPRsForPO, useGeneralPOFormData } from "../queries";
import { useCreateGeneralPurchaseOrder } from "../mutations";

export function NewGeneralPOPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPRId = searchParams.get("pr_id") || undefined;

  const formQuery = useGeneralPOFormData();
  const prsQuery = useApprovedGeneralPRsForPO();
  const createMutation = useCreateGeneralPurchaseOrder();

  const approvedPRs = useMemo(() => {
    const all = prsQuery.data ?? [];
    if (!initialPRId) return all;
    const selected = all.find((pr) => pr.id === initialPRId);
    return selected ? [selected, ...all.filter((pr) => pr.id !== initialPRId)] : all;
  }, [prsQuery.data, initialPRId]);

  if (formQuery.isLoading) {
    return <div className="py-20 text-center text-sm text-gray-500">Memuat form purchase order...</div>;
  }

  if (formQuery.isError || !formQuery.data) {
    return <div className="py-12 text-center text-sm text-red-600">Gagal memuat data form purchase order.</div>;
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={GENERAL_ROUTES.purchasingPo}
        title="Buat Purchase Order"
        description="Buat purchase order barang operasional ke vendor"
      />
      <GeneralPOForm
        vendors={formQuery.data.vendors}
        supplies={formQuery.data.supplies}
        units={formQuery.data.units}
        approvedPRs={approvedPRs}
        initialPRId={initialPRId}
        isLoading={createMutation.isPending}
        cancelHref={GENERAL_ROUTES.purchasingPo}
        onSubmit={async (payload) => {
          try {
            const result = await createMutation.mutateAsync(payload);
            toast.success("Purchase order berhasil dibuat.");
            router.push(GENERAL_ROUTES.purchasingPoDetail(result.data.id));
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Gagal membuat purchase order.");
            throw error;
          }
        }}
      />
    </div>
  );
}
