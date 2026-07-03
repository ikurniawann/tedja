"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { ProductPOForm } from "@/components/purchasing/product-po-form";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { useRouter } from "next/navigation";
import {
  useApprovedProductPRsForPO,
  useProductPOFormData,
} from "../queries";
import { useCreateProductPurchaseOrder } from "../mutations";

export function NewProductPOPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPRId = searchParams.get("pr_id") || undefined;

  const formQuery = useProductPOFormData();
  const prsQuery = useApprovedProductPRsForPO();
  const createMutation = useCreateProductPurchaseOrder();

  const approvedPRs = useMemo(() => {
    const all = prsQuery.data ?? [];
    if (!initialPRId) return all;
    const selected = all.find((pr) => pr.id === initialPRId);
    return selected ? [selected, ...all.filter((pr) => pr.id !== initialPRId)] : all;
  }, [prsQuery.data, initialPRId]);

  if (formQuery.isLoading) {
    return <div className="py-20 text-center text-sm text-gray-500">Loading purchase order form...</div>;
  }

  if (formQuery.isError || !formQuery.data) {
    return <div className="py-12 text-center text-sm text-red-600">Failed to load purchase order form data.</div>;
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.purchasingPo}
        title="Create Purchase Order"
        description="Create a product purchase order to a vendor"
      />
      <ProductPOForm
        vendors={formQuery.data.vendors}
        products={formQuery.data.products}
        units={formQuery.data.units}
        approvedPRs={approvedPRs}
        initialPRId={initialPRId}
        isLoading={createMutation.isPending}
        cancelHref={PRODUCT_ROUTES.purchasingPo}
        onSubmit={async (payload) => {
          try {
            const result = await createMutation.mutateAsync(payload);
            toast.success("Purchase order created successfully.");
            router.push(PRODUCT_ROUTES.purchasingPoDetail(result.data.id));
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to create purchase order.");
            throw error;
          }
        }}
      />
    </div>
  );
}
