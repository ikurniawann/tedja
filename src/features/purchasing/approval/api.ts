import type { ApprovalPR } from "./types";

export type { ApprovalPR } from "./types";

export async function listPendingPRApprovals(): Promise<ApprovalPR[]> {
  const res = await fetch("/api/purchasing/pr?status=pending_head&limit=50");
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "Failed to load purchase request approvals");
  return payload.data || [];
}

export async function approvePRApproval(id: string): Promise<void> {
  const res = await fetch(`/api/purchasing/pr/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "approve" }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "Failed to approve purchase request");
}

export async function rejectPRApproval(id: string, reason: string): Promise<void> {
  const res = await fetch(`/api/purchasing/pr/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reject", reason }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "Failed to reject purchase request");
}
