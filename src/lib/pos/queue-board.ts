import type { KDSOrder } from "@/features/pos/kds/types";

const PREPARING_STATUSES = new Set(["pending", "confirmed", "preparing"]);

function queueKey(order: KDSOrder) {
  return String(order.queue_number || order.order_number || "");
}

function byQueueNumber(a: KDSOrder, b: KDSOrder) {
  return queueKey(a).localeCompare(queueKey(b), undefined, { numeric: true });
}

export function orderBoardStatus(order: Pick<KDSOrder, "station_status" | "status">) {
  return String(order.station_status || order.status || "pending").toLowerCase();
}

export function splitQueueBoardOrders(orders: KDSOrder[]) {
  const preparing: KDSOrder[] = [];
  const ready: KDSOrder[] = [];

  for (const order of orders) {
    const status = orderBoardStatus(order);
    if (status === "ready") ready.push(order);
    else if (PREPARING_STATUSES.has(status)) preparing.push(order);
  }

  preparing.sort(byQueueNumber);
  ready.sort(byQueueNumber);
  return { preparing, ready };
}

export function readyOrderIds(orders: KDSOrder[]) {
  return new Set(
    splitQueueBoardOrders(orders).ready.map((order) => order.id)
  );
}
