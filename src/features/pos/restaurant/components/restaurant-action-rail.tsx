"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ClipboardList,
  Clock,
  CreditCard,
  MessageSquare,
  MoveRight,
  Printer,
  ReceiptText,
  Split,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { printThermalReceipt, type ReceiptPayload } from "@/components/pos/PrintReceipt";
import type { Order } from "@/features/pos/open-bills/types";

import { buildCashierHandoffUrl } from "../nav";
import type { NullableRestaurantSelection } from "../selection";

const ORDERS_PATH = "/dashboard/pos/orders";
const LAST_RECEIPT_KEY = "pos:lastReceipt";

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now.toLocaleTimeString("en-GB", { hour12: false });
}

export interface RestaurantActionRailProps {
  selection: NullableRestaurantSelection;
  selectedOrder: Order | null;
  onSplitBill: () => void;
  onMoveTable: () => void;
}

export function RestaurantActionRail({
  selection,
  selectedOrder,
  onSplitBill,
  onMoveTable,
}: RestaurantActionRailProps) {
  const router = useRouter();
  const clock = useLiveClock();
  const orderId = selection?.orderId;

  const requireSelection = () => {
    if (orderId) return true;
    toast.error("Select an occupied table or bill");
    return false;
  };

  const handleOrderCheck = () => {
    if (!requireSelection()) return;
    router.push(buildCashierHandoffUrl({ orderId, tableId: selection?.tableId }));
  };

  const handlePreSettlement = () => {
    if (!requireSelection()) return;
    router.push(
      buildCashierHandoffUrl({ orderId, tableId: selection?.tableId, pay: true })
    );
  };

  const handleSplitBill = () => {
    if (!selectedOrder) {
      toast.error("Select an occupied table or bill");
      return;
    }
    onSplitBill();
  };

  const handleMoveTable = () => {
    if (!selectedOrder) {
      toast.error("Select an occupied table or bill");
      return;
    }
    onMoveTable();
  };

  const handleReprint = () => {
    const raw = window.sessionStorage.getItem(LAST_RECEIPT_KEY);
    if (!raw) {
      toast.message("No recent receipt found to reprint.");
      return;
    }

    try {
      const payload = JSON.parse(raw) as ReceiptPayload;
      printThermalReceipt(payload, "CUSTOMER");
    } catch {
      toast.error("Could not read the last receipt.");
    }
  };

  const actions = [
    {
      key: "waiting-list",
      label: "Waiting List",
      icon: Users,
      onClick: () => toast.message("Waiting List coming soon"),
    },
    { key: "order-check", label: "Order Check", icon: ReceiptText, onClick: handleOrderCheck },
    {
      key: "pre-settlement",
      label: "Pre Settlement",
      icon: CreditCard,
      onClick: handlePreSettlement,
    },
    { key: "split-bill", label: "Split Bill", icon: Split, onClick: handleSplitBill },
    { key: "move-table", label: "Move Table", icon: MoveRight, onClick: handleMoveTable },
    { key: "reprint", label: "Reprint", icon: Printer, onClick: handleReprint },
    {
      key: "message",
      label: "Message",
      icon: MessageSquare,
      onClick: () => toast.message("Message coming soon"),
    },
  ] as const;

  return (
    <aside className="flex h-fit flex-col gap-2 rounded-xl border border-gray-200/70 bg-white p-3 shadow-xs">
      <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50/80 py-2.5 text-sm font-semibold tabular-nums text-gray-900">
        <Clock className="size-4 text-muted-foreground" />
        {clock}
      </div>

      {actions.map((action) => (
        <Button
          key={action.key}
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 border-gray-200/70 text-gray-700 hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
          onClick={action.onClick}
        >
          <action.icon className="size-4" />
          {action.label}
        </Button>
      ))}

      <Button
        type="button"
        variant="outline"
        className="w-full justify-start gap-2 border-primary/20 text-primary hover:bg-primary/10"
        onClick={() => router.push(ORDERS_PATH)}
      >
        <ClipboardList className="size-4" />
        View Orders
      </Button>
    </aside>
  );
}
