"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { RM_ROUTES } from "@/modules/purchasing/constants/item-routes";

type PRRevisionButtonProps = {
  prId: string;
};

export function PRRevisionButton({ prId }: PRRevisionButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function createRevision() {
    setLoading(true);
    try {
      const response = await fetch(`/api/purchasing/pr/${prId}/revise`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create purchase request revision");
      }

      setOpen(false);
      router.push(`${RM_ROUTES.purchasingPrEdit(payload.data.id)}?revision=created`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create purchase request revision"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="purchasing-secondary-button w-full sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <FileText className="mr-2 h-4 w-4" />
        Create Revision
      </Button>

      <Dialog open={open} onOpenChange={(open) => !loading && setOpen(open)}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Create Revision?</DialogPanelTitle>
            <DialogPanelDescription>
              A new draft purchase request will be created from this rejected request. The
              original request remains in history.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody />
          <DialogFooter className="px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="purchasing-secondary-button"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="purchasing-main-button"
              onClick={createRevision}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? "Creating..." : "Create Revision"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </>
  );
}
