'use client';

import { useEffect, useRef, useState } from 'react';
import { ChefHat, CheckCircle2, ArrowRight, Utensils, Flame, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

import type { KDSOrder } from "@/features/pos/kds/types";

interface KDSOrderCardProps {
  order: KDSOrder;
  onStatusChange: (orderId: string, newStatus: string) => void | Promise<void>;
  index: number;
}

const STATUS_FLOW: Record<string, string> = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'served',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Tunggu',
  confirmed: 'Konfirmasi',
  preparing: 'Proses',
  ready: 'Siap',
  served: 'Sajikan',
};

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  pending: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-900', badge: 'bg-amber-100 text-amber-700' },
  confirmed: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-900', badge: 'bg-blue-100 text-blue-700' },
  preparing: { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-900', badge: 'bg-orange-100 text-orange-700' },
  ready: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-900', badge: 'bg-green-100 text-green-700' },
  served: { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-600' },
};

const ACTION_BUTTON_COLORS: Record<string, string> = {
  confirmed: 'bg-blue-600 hover:bg-blue-700 text-white',
  preparing: 'bg-orange-500 hover:bg-orange-600 text-white',
  ready: 'bg-green-600 hover:bg-green-700 text-white',
  served: 'bg-pink-600 hover:bg-pink-700 text-white',
};

const STATION_LABELS: Record<string, string> = {
  kitchen: 'Kitchen',
  bar: 'Bar',
  bakery: 'Bakery',
  dessert: 'Dessert',
  merchandise: 'Merch',
  photobooth: 'Photo',
};

function formatWaitTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 1) return `${s}d`;
  if (m < 60) return `${m}m ${s}d`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}j ${rem}m`;
}

export function KDSOrderCard({ order, onStatusChange, index }: KDSOrderCardProps) {
  const displayStatus = order.station_status || order.status;
  const colors = STATUS_COLORS[displayStatus] || STATUS_COLORS.pending;
  const nextStatus = STATUS_FLOW[displayStatus];
  const paid = String(order.payment_status || '').toLowerCase() === 'paid';
  const actionButtonClass = nextStatus ? ACTION_BUTTON_COLORS[nextStatus] || 'bg-gray-900 hover:bg-gray-800 text-white' : '';
  const [elapsed, setElapsed] = useState(order.wait_seconds);
  const [updating, setUpdating] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleBump = async () => {
    if (!nextStatus || updating) return;
    setUpdating(true);
    try {
      await onStatusChange(order.id, nextStatus);
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    // Keep the kitchen ticket timer aligned when polling returns a fresh wait value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsed(order.wait_seconds);
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [order.wait_seconds]);

  const bgPulse = order.is_overdue ? 'animate-pulse' : '';
  const isUrgent = order.is_urgent || order.is_overdue;

  return (
    <div
      className={`relative flex flex-col rounded-xl border-2 ${colors.border} ${colors.bg} p-4 shadow-sm transition-all hover:shadow-md ${bgPulse}`}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide ${colors.badge}`}>
            {STATUS_LABELS[displayStatus] || displayStatus}
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
              paid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            {paid ? 'Lunas' : 'Open'}
          </span>
          {isUrgent && (
            <Flame className="w-4 h-4 text-red-500 animate-bounce" />
          )}
        </div>
        <div className="text-right">
          <p className={`text-3xl font-black tabular-nums leading-none ${isUrgent ? 'text-red-600' : colors.text}`}>
            {order.queue_number || '—'}
          </p>
          <p className="mt-1 text-[10px] text-gray-500">No. Antrian</p>
          <p className={`text-xs font-semibold ${isUrgent ? 'text-red-600' : colors.text}`}>
            {formatWaitTime(elapsed)}
          </p>
          <p className="text-[10px] text-gray-500 font-mono">{order.order_number}</p>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 space-y-1.5 mb-4">
        {order.pos_order_items?.map((item) => (
          <div key={item.id} className="flex items-start justify-between text-sm">
            <div className="flex items-start gap-2">
              <span className={`inline-flex items-center justify-center min-w-[24px] h-6 rounded font-bold text-xs ${colors.bg} ${colors.text} border ${colors.border}`}>
                {item.quantity}
              </span>
              <div>
                <p className="font-semibold text-gray-900 leading-tight">{item.product_name}</p>
                {item.station && (
                  <span className="mt-1 inline-flex rounded-full bg-gray-900/5 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {STATION_LABELS[item.station] || item.station}
                  </span>
                )}
                {(item.variant_info || item.modifier_info) && (
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {item.variant_info} {item.modifier_info}
                  </p>
                )}
                {item.notes && (
                  <p className="text-[10px] text-amber-600 italic mt-0.5">&quot;{item.notes}&quot;</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-dashed border-gray-300">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          {order.order_type === 'dine_in' ? (
            <Utensils className="w-3.5 h-3.5" />
          ) : (
            <ChefHat className="w-3.5 h-3.5" />
          )}
          <span className="capitalize">{order.order_type.replace('_', ' ')}</span>
          {(order.table_label || order.table_id) && (
            <span className="text-gray-400">· {order.table_label || `Meja ${order.table_id?.slice(0, 8)}`}</span>
          )}
        </div>

        {nextStatus ? (
          <Button
            size="sm"
            onClick={() => void handleBump()}
            disabled={updating}
            className={`${actionButtonClass} text-xs h-8 px-3 gap-1 shadow-sm`}
          >
            {updating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : nextStatus === 'ready' ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5" />
            )}
            {updating ? 'Menyimpan...' : STATUS_LABELS[nextStatus] || nextStatus}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled
            className="text-xs h-8 px-3"
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-green-600" /> Selesai
          </Button>
        )}
      </div>

      {/* Overdue warning overlay */}
      {order.is_overdue && (
        <div className="absolute inset-x-0 top-0 h-1 bg-red-500 rounded-t-xl" />
      )}
    </div>
  );
}
