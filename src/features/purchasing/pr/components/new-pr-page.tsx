"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PRForm } from "@/components/purchasing/pr-form";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { usePRFormData } from "../queries";
import { useCreatePurchaseRequest } from "../mutations";
import type { PRFormInput } from "../types";

export function NewPRPage() {
  const router = useRouter();
  const { data: formData, isLoading, error, isError } = usePRFormData();
  const createMutation = useCreatePurchaseRequest();

  useEffect(() => {
    if (isError && error instanceof Error && error.message.includes("403")) {
      router.replace("/dashboard/purchasing");
    }
  }, [isError, error, router]);

  async function handleCreatePR(data: PRFormInput, action: "draft" | "submit") {
    try {
      await createMutation.mutateAsync({ ...data, action });
      toast.success(
        action === "draft" ? "Draft purchase request saved" : "Purchase request submitted"
      );
      router.push("/dashboard/purchasing/pr");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save purchase request");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-500">
        Loading purchase request form...
      </div>
    );
  }

  if (isError || !formData) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error instanceof Error ? error.message : "Failed to load purchase request form data"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref="/dashboard/purchasing/pr"
        title="Create Purchase Request"
        description="Enter purchasing needs before creating a purchase order"
      />

      <PRForm
        departments={formData.departments}
        materials={formData.materials}
        units={formData.units}
        onSubmit={handleCreatePR}
        isLoading={createMutation.isPending}
        cancelHref="/dashboard/purchasing/pr"
      />
    </div>
  );
}
