'use client';

import { useEffect, useState } from 'react';
import { Lock, Unlock, Loader2, Banknote, Receipt, Clock } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatAmount } from '@/lib/purchasing/utils';
import type { PosShift } from '@/lib/pos-api';

interface ShiftSummary {
  total_orders?: number;
  total_sales?: number;
  opening_cash?: number;
  expected_cash?: number;
  closing_cash?: number;
  variance?: number;
}

interface ShiftModalProps {
  open: boolean;
  shift: PosShift | null;
  onClose: () => void;
  onOpenShift: (openingCash: number, notes?: string) => Promise<{ success?: boolean; error?: string }>;
  onCloseShift: (closingCash: number, notes?: string) => Promise<{
    success?: boolean;
    error?: string;
    summary?: ShiftSummary;
  }>;
  /** @deprecated Use internal formatAmount — kept for backward compatibility */
  formatCurrency?: (n: number) => string;
}

function formatMoney(value: number) {
  return formatAmount(value);
}

function formatShiftTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseCashInput(value: string) {
  return parseInt(value.replace(/\D/g, '') || '0', 10);
}

function formatCashInputDisplay(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const num = Number.parseInt(digits, 10);
  if (!Number.isFinite(num)) return '';
  return formatAmount(num);
}

function hasCashInput(value: string) {
  return value.replace(/\D/g, '').length > 0;
}

export function ShiftModal({
  open,
  shift,
  onClose,
  onOpenShift,
  onCloseShift,
}: ShiftModalProps) {
  const [view, setView] = useState<'open' | 'close' | 'summary'>('open');
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    setView(shift ? 'close' : 'open');
    setOpeningCash('');
    setClosingCash('');
    setNotes('');
    setSummary(null);
    setBusy(false);
  }, [open, shift]);

  const handleDismiss = () => {
    setView(shift ? 'close' : 'open');
    setOpeningCash('');
    setClosingCash('');
    setNotes('');
    setSummary(null);
    setBusy(false);
    onClose();
  };

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseCashInput(openingCash);
    if (val < 0) return;

    setBusy(true);
    try {
      const res = await onOpenShift(val, notes.trim() || undefined);
      if (res.success) {
        toast.success('Shift opened successfully');
        handleDismiss();
      } else {
        toast.error(res.error || 'Failed to open shift');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseCashInput(closingCash);
    if (val < 0) return;

    setBusy(true);
    try {
      const res = await onCloseShift(val, notes.trim() || undefined);
      if (res.success) {
        setSummary(res.summary ?? null);
        setView('summary');
        toast.success('Shift closed successfully');
      } else {
        toast.error(res.error || 'Failed to close shift');
      }
    } finally {
      setBusy(false);
    }
  };

  const isSummary = view === 'summary' && summary;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <DialogPanel size={isSummary ? 'sm' : 'md'}>
        {isSummary ? (
          <>
            <DialogPanelHeader>
              <DialogPanelTitle>Shift Summary</DialogPanelTitle>
              <DialogPanelDescription>Review closing totals before finishing.</DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div className="rounded-xl border border-gray-200/70 bg-gray-50/80 p-4 text-sm shadow-xs">
                <SummaryRow label="Total Orders" value={String(summary.total_orders ?? 0)} />
                <SummaryRow label="Total Sales" value={formatMoney(summary.total_sales ?? 0)} bold />
                <SummaryRow label="Opening Cash" value={formatMoney(summary.opening_cash ?? 0)} />
                <SummaryRow label="Expected Cash" value={formatMoney(summary.expected_cash ?? 0)} />
                <SummaryRow label="Physical Cash" value={formatMoney(summary.closing_cash ?? 0)} />
                <SummaryRow
                  label="Variance"
                  value={formatMoney(summary.variance ?? 0)}
                  bold
                  valueClassName={
                    summary.variance !== 0 ? 'text-red-600' : 'text-green-600'
                  }
                />
              </div>
            </DialogPanelBody>
            <DialogFooter>
              <Button
                type="button"
                onClick={handleDismiss}
                className="bg-primary hover:bg-primary/90"
              >
                Done
              </Button>
            </DialogFooter>
          </>
        ) : shift ? (
          <DialogPanelForm onSubmit={handleClose}>
            <DialogPanelHeader>
              <DialogPanelTitle className="flex items-center gap-2">
                <Unlock className="h-4 w-4 text-green-600" />
                Close Shift
              </DialogPanelTitle>
              <DialogPanelDescription>
                Count physical cash in the drawer and close the active shift.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div className="rounded-xl border border-green-200/70 bg-green-50/60 p-4 text-sm shadow-xs">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wide text-green-800">
                    {shift.shift_number}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-green-700">
                    <Clock className="h-3.5 w-3.5" />
                    {formatShiftTime(shift.opened_at)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    icon={Banknote}
                    label="Opening Cash"
                    value={formatMoney(shift.opening_cash)}
                  />
                  <StatCard
                    icon={Receipt}
                    label="Orders"
                    value={String(shift.total_orders ?? 0)}
                  />
                </div>
                <div className="mt-3 border-t border-green-200/70 pt-3">
                  <p className="text-xs text-green-700">Total Sales</p>
                  <p className="text-lg font-bold text-green-900">{formatMoney(shift.total_sales ?? 0)}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="closing-cash" className="text-xs font-medium text-gray-700">
                  Closing Cash <span className="text-red-500">*</span>
                </label>
                <Input
                  id="closing-cash"
                  type="text"
                  inputMode="numeric"
                  placeholder="500.000"
                  value={closingCash}
                  onChange={(e) => setClosingCash(formatCashInputDisplay(e.target.value))}
                  className="h-9 text-sm focus:border-primary/50 focus-visible:ring-ring"
                  disabled={busy}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="close-notes" className="text-xs font-medium text-gray-700">
                  Notes
                </label>
                <Input
                  id="close-notes"
                  placeholder="Optional closing notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-9 text-sm focus:border-primary/50 focus-visible:ring-ring"
                  disabled={busy}
                />
              </div>
            </DialogPanelBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleDismiss} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="outline"
                disabled={busy || !hasCashInput(closingCash)}
                className="border-red-200/80 text-red-600 hover:bg-red-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Closing...
                  </>
                ) : (
                  'Close Shift'
                )}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        ) : (
          <DialogPanelForm onSubmit={handleOpen}>
            <DialogPanelHeader>
              <DialogPanelTitle className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" />
                Open Shift
              </DialogPanelTitle>
              <DialogPanelDescription>
                Start a new cashier shift before processing transactions.
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
                No active shift. Open a shift to accept orders and payments.
              </div>

              <div className="space-y-1.5">
                <label htmlFor="opening-cash" className="text-xs font-medium text-gray-700">
                  Opening Cash <span className="text-red-500">*</span>
                </label>
                <Input
                  id="opening-cash"
                  type="text"
                  inputMode="numeric"
                  placeholder="500.000"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(formatCashInputDisplay(e.target.value))}
                  className="h-9 text-sm focus:border-primary/50 focus-visible:ring-ring"
                  disabled={busy}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="open-notes" className="text-xs font-medium text-gray-700">
                  Notes
                </label>
                <Input
                  id="open-notes"
                  placeholder="Optional shift notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-9 text-sm focus:border-primary/50 focus-visible:ring-ring"
                  disabled={busy}
                />
              </div>
            </DialogPanelBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleDismiss} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || !hasCashInput(openingCash)}
                className="bg-primary hover:bg-primary/90"
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Opening...
                  </>
                ) : (
                  'Open Shift'
                )}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        )}
      </DialogPanel>
    </Dialog>
  );
}

function SummaryRow({
  label,
  value,
  bold,
  valueClassName,
}: {
  label: string;
  value: string;
  bold?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-gray-500">{label}</span>
      <span className={bold ? `font-semibold text-gray-900 ${valueClassName ?? ''}` : `text-gray-900 ${valueClassName ?? ''}`}>
        {value}
      </span>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-green-200/60 bg-white/70 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-green-700">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}
