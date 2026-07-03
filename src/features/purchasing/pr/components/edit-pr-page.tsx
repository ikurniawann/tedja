"use client";

import { use, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PRForm } from "@/components/purchasing/pr-form";
import { PRDetailToast } from "@/components/purchasing/pr-detail-toast";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { usePRFormData, usePurchaseRequest } from "../queries";
import { useUpdatePurchaseRequest } from "../mutations";
import type { PRFormInput } from "../types";

type EditPRPageProps = {
  params: Promise<{ id: string }>;
};

export function EditPRPage({ params }: EditPRPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data: pr, isLoading: prLoading, error: prError } = usePurchaseRequest(id);
  const { data: formData, isLoading: formLoading } = usePRFormData();
  const updateMutation = useUpdatePurchaseRequest();

  useEffect(() => {
    if (!pr) return;
    if (!pr.permissions.canEdit) {
      router.replace(`/dashboard/purchasing/pr/${id}`);
    }
  }, [pr, id, router]);

  const initialData = useMemo<PRFormInput | undefined>(() => {
    if (!pr) return undefined;
    return {
      department_id: pr.department_id,
      priority: pr.priority as PRFormInput["priority"],
      required_date: pr.required_date || "",
      notes: pr.notes || "",
      items: (pr.items || []).map((item) => ({
        raw_material_id: item.raw_material_id || "",
        satuan_id: item.satuan_id || "",
        description: item.description || "",
        qty: item.qty || 1,
        unit: item.unit || "",
        estimated_price: item.estimated_price || 0,
      })),
    };
  }, [pr]);

  async function handleUpdatePR(data: PRFormInput, action: "draft" | "submit") {
    try {
      await updateMutation.mutateAsync({ id, payload: { ...data, action } });
      toast.success(
        action === "submit" ? "Purchase request submitted" : "Purchase request changes saved"
      );
      router.push(`/dashboard/purchasing/pr/${id}?updated=${action}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save purchase request");
    }
  }

  if (prLoading || formLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-500">
        Loading purchase request...
      </div>
    );
  }

  if (prError || !pr || !formData || !initialData) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {prError instanceof Error ? prError.message : "Purchase request not found"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PRDetailToast />
      <PurchasingFormHeader
        backHref={`/dashboard/purchasing/pr/${id}`}
        title="Edit Purchase Request"
        description="Changes are only allowed while the purchase request is still a draft"
      />

      <PRForm
        departments={formData.departments}
        materials={formData.materials}
        units={formData.units}
        initialData={initialData}
        mode="edit"
        onSubmit={handleUpdatePR}
        isLoading={updateMutation.isPending}
        cancelHref={`/dashboard/purchasing/pr/${id}`}
      />
    </div>
  );
}
