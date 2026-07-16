"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface ApprovalButtonsProps {
  leaveId: string;
  currentStatus: string;
  onApprove?: (data: any) => void;
  onReject?: (data: any) => void;
  disabled?: boolean;
}

export function ApprovalButtons({
  leaveId,
  currentStatus,
  onApprove,
  onReject,
  disabled = false,
}: ApprovalButtonsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const { toast } = useToast();

  const isProcessed = currentStatus !== "pending";

  const handleApprove = async () => {
    try {
      setIsLoading(true);

      const response = await fetch("/api/hris/leaves/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leave_id: leaveId,
          action: "approve",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to approve");
      }

      toast({
        title: "✅ Pengajuan Disetujui",
        description: result.wa_link
          ? "Membuka WhatsApp untuk memberi tahu karyawan…"
          : "Leave request telah disetujui",
      });
      if (result.wa_link) window.open(result.wa_link, "_blank");

      onApprove?.(result.data);
    } catch (error) {
      console.error("Approve error:", error);
      toast({
        title: "Error",
        description: "Gagal menyetujui pengajuan.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRejectClick = () => {
    setShowRejectDialog(true);
    setRejectionReason("");
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast({
        title: "⚠️ Alasan Ditolak",
        description: "Mohon isi alasan penolakan",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsLoading(true);

      const response = await fetch("/api/hris/leaves/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leave_id: leaveId,
          action: "reject",
          rejection_reason: rejectionReason.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to reject");
      }

      toast({
        title: "❌ Pengajuan Ditolak",
        description: result.wa_link
          ? "Membuka WhatsApp untuk memberi tahu karyawan…"
          : rejectionReason.trim(),
      });
      if (result.wa_link) window.open(result.wa_link, "_blank");

      onReject?.(result.data);
      setShowRejectDialog(false);
      setRejectionReason("");
    } catch (error) {
      console.error("Reject error:", error);
      toast({
        title: "Error",
        description: "Gagal menolak pengajuan.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isProcessed) {
    return (
      <Badge
        variant="outline"
        className={
          currentStatus === "approved"
            ? "bg-green-100 text-green-800 border-green-300"
            : "bg-red-100 text-red-800 border-red-300"
        }
      >
        {currentStatus === "approved" ? (
          <>
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Disetujui
          </>
        ) : (
          <>
            <XCircle className="w-3 h-3 mr-1" />
            Ditolak
          </>
        )}
      </Badge>
    );
  }

  return (
    <>
      <div className="flex gap-2">
        <Button
          onClick={handleApprove}
          disabled={isLoading || disabled}
          className="bg-green-600 hover:bg-green-700"
          size="sm"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 mr-1" />
              Setujui
            </>
          )}
        </Button>

        <Button
          onClick={handleRejectClick}
          disabled={isLoading || disabled}
          variant="outline"
          size="sm"
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <XCircle className="w-4 h-4 mr-1" />
              Tolak
            </>
          )}
        </Button>
      </div>

      {/* Rejection Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak Pengajuan Cuti</DialogTitle>
            <DialogDescription>
              Berikan alasan penolakan yang akan disampaikan kepada karyawan.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Contoh: Jumlah staff yang tidak mencukupi pada periode tersebut..."
            rows={4}
            className="resize-none"
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowRejectDialog(false)}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleReject}
              disabled={!rejectionReason.trim() || isLoading}
              variant="destructive"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Menolak...
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 mr-2" />
                  Tolak Pengajuan
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
