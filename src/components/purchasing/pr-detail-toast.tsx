"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

const TOAST_MESSAGES: Record<string, string> = {
  "created:draft": "Purchase request draft saved",
  "created:submit": "Purchase request submitted",
  "updated:draft": "Purchase request changes saved",
  "updated:submit": "Purchase request submitted",
  "approval:approved": "Purchase request approved",
  "approval:rejected": "Purchase request rejected",
  "revision:created": "Revision draft created",
};

export function PRDetailToast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handledKey = useRef<string | null>(null);

  useEffect(() => {
    const candidates = [
      ["created", searchParams.get("created")],
      ["updated", searchParams.get("updated")],
      ["approval", searchParams.get("approval")],
      ["revision", searchParams.get("revision")],
    ] as const;

    const match = candidates.find(([, value]) => Boolean(value));
    if (!match) return;

    const key = `${match[0]}:${match[1]}`;
    if (handledKey.current === key) return;

    const message = TOAST_MESSAGES[key];
    if (!message) return;

    handledKey.current = key;
    toast.success(message);
    router.replace(pathname);
  }, [pathname, router, searchParams]);

  return null;
}
