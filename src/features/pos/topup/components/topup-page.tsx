'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Check,
  Coins,
  CreditCard,
  Loader2,
  Nfc,
  Printer,
  QrCode,
  Search,
  User,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CustomerSearchModal } from '@/components/pos/CustomerSearchModal';
import { findCustomerByCard } from '@/features/pos/nfc';
import { saveCustomer } from '@/lib/pos-api';
import type { CustomerWithDiscount } from '@/hooks/use-pos-customers';
import { cn } from '@/lib/utils';
import type { PaymentMethod, TopupCustomer, TopupResult, TopupStatus } from '../types';
import { useTopupCustomers } from '../queries';
import { useProcessTopup } from '../mutations';
import { listTopupCustomers } from '../api';
import { printTopupReceipt } from '../print-topup-receipt';

const ARK_RATE = 1000;
const presetValues = [50000, 100000, 200000, 500000, 1000000];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value || 0);

const formatArk = (value: number) => `${((value || 0) / ARK_RATE).toLocaleString('id-ID')} ARK`;

function parseAmountInput(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 0;
  return Number.parseInt(digits, 10) || 0;
}

function tierBadgeClass(tier?: string | null) {
  const value = String(tier || 'bronze').toLowerCase();
  if (value === 'platinum') return 'bg-violet-100 text-violet-700';
  if (value === 'gold') return 'bg-amber-100 text-amber-800';
  if (value === 'silver') return 'bg-slate-100 text-slate-700';
  return 'bg-sky-100 text-sky-700';
}

export function TopupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cardParam = searchParams.get('card');
  const cardHandledRef = useRef<string | null>(null);

  const [step, setStep] = useState<TopupStatus>('idle');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customer, setCustomer] = useState<TopupCustomer | null>(null);
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [topupRp, setTopupRp] = useState(0);
  const [customRp, setCustomRp] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('qris');
  const [showReceipt, setShowReceipt] = useState(false);
  const [result, setResult] = useState<TopupResult | null>(null);
  const [error, setError] = useState('');
  const [resolvingCard, setResolvingCard] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [showCreateFromNfc, setShowCreateFromNfc] = useState(false);
  const [pendingNfcUid, setPendingNfcUid] = useState<string | null>(null);
  const [createSearch, setCreateSearch] = useState('');

  const { data: customers = [], isLoading: loadingCustomers, error: customersError, refetch } =
    useTopupCustomers({ search: customerSearch });
  const topupMutation = useProcessTopup();

  const filtered = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((item) =>
      `${item.name || ''} ${item.phone} ${item.nfc_uid || ''}`.toLowerCase().includes(query)
    );
  }, [customers, customerSearch]);

  const projectedBalance = customer ? Number(customer.ark_coin_balance || 0) + topupRp : 0;
  const customersErrorMessage = customersError instanceof Error ? customersError.message : '';

  const modalCustomers: CustomerWithDiscount[] = useMemo(
    () =>
      customers.map((item) => ({
        id: item.id,
        phone: item.phone,
        name: item.name || undefined,
        membership_tier: item.membership_tier || 'regular',
        ark_coin_balance: Number(item.ark_coin_balance || 0),
        total_xp: 0,
        total_spent: 0,
        visit_count: 0,
        discount: 0,
        nfc_uid: item.nfc_uid,
      })),
    [customers]
  );

  function clearCardParam() {
    router.replace('/dashboard/pos/topup');
  }

  function selectCustomer(item: TopupCustomer) {
    setCustomer(item);
    setShowCustomerList(false);
    setShowCreateFromNfc(false);
    setPendingNfcUid(null);
    setStep('enter_amount');
    setTopupRp(0);
    setCustomRp('');
    setResult(null);
    setError('');
  }

  async function handleCreateCustomer(payload: {
    name: string;
    phone: string;
    email?: string;
    enroll_member: boolean;
    nfc_uid?: string;
  }) {
    const response = await saveCustomer({
      name: payload.name,
      phone: payload.phone,
      email: payload.email,
      membership_tier: 'bronze',
      enroll_member: payload.enroll_member,
      nfc_uid: payload.nfc_uid,
    });
    await refetch();
    const created = response.data;
    return {
      ...created,
      discount: 0,
    } as CustomerWithDiscount;
  }

  useEffect(() => {
    const card = cardParam?.trim();
    if (!card) {
      cardHandledRef.current = null;
      return;
    }
    if (cardHandledRef.current === card) return;

    let cancelled = false;

    async function resolveCard() {
      setResolvingCard(true);
      setError('');
      try {
        const list = await listTopupCustomers({});
        if (cancelled) return;
        const found = findCustomerByCard(list, card!);
        cardHandledRef.current = card!;
        clearCardParam();
        if (!found) {
          setPendingNfcUid(card!.toUpperCase());
          setShowCreateFromNfc(true);
          toast.message('Kartu belum terdaftar. Lengkapi data member.');
          return;
        }
        toast.success(`Member ${found.name || found.phone} dipilih`);
        selectCustomer(found);
      } catch (err) {
        if (cancelled) return;
        cardHandledRef.current = card!;
        clearCardParam();
        const message = err instanceof Error ? err.message : 'Gagal membaca kartu';
        toast.error(message);
        setError(message);
      } finally {
        if (!cancelled) setResolvingCard(false);
      }
    }

    void resolveCard();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardParam]);

  async function openCustomerList() {
    setShowCustomerList(true);
    if (customers.length === 0) await refetch();
  }

  function selectPreset(value: number) {
    setTopupRp(value);
    setCustomRp(formatCurrency(value));
  }

  function handleCustom(value: string) {
    const amount = parseAmountInput(value);
    setTopupRp(amount);
    setCustomRp(amount > 0 ? formatCurrency(amount) : '');
  }

  function goBack() {
    setError('');
    if (step === 'enter_amount') {
      setStep('idle');
      setCustomer(null);
    } else if (step === 'payment') {
      setStep('enter_amount');
    }
  }

  async function pay() {
    if (!customer || topupRp < 10000) return;
    setStep('processing');
    setError('');

    try {
      const data = await topupMutation.mutateAsync({
        customer_id: customer.id,
        amount: topupRp,
        payment_method: payment === 'credit_card' ? 'credit' : payment,
      });
      const balanceAfter = Number(data.balance_after || projectedBalance);
      setResult(data);
      setCustomer({ ...customer, ark_coin_balance: balanceAfter });
      setStep('success');
      toast.success(
        `Top-up successful. ${formatArk(topupRp)} added. New balance: ${formatArk(balanceAfter)}.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Top-up failed';
      setError(message);
      setStep('payment');
      toast.error(message);
    }
  }

  function newTopup() {
    setTopupRp(0);
    setCustomRp('');
    setResult(null);
    setStep('enter_amount');
  }

  function handlePrintReceipt() {
    if (!customer || !result || printingReceipt) return;
    try {
      setPrintingReceipt(true);
      printTopupReceipt({
        customerName: customer.name || customer.phone || 'Member',
        phone: customer.phone,
        amount: topupRp,
        arkAmountLabel: formatArk(topupRp),
        amountLabel: formatCurrency(topupRp),
        paymentMethod: payment,
        balanceBeforeLabel: formatArk(result.balance_before),
        balanceAfterLabel: formatArk(result.balance_after),
        cardId: customer.nfc_uid,
      });
      toast.success('Receipt sent to printer');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to print receipt');
    } finally {
      window.setTimeout(() => setPrintingReceipt(false), 400);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] w-full flex-col">
      <div className="mb-4 flex items-center gap-3">
        {step !== 'idle' && (
          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-gray-200/70 p-1.5 text-muted-foreground hover:bg-muted/50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">Topup ARK</h1>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">1 ARK = 1.000</span>
      </div>

      {(error || customersErrorMessage) && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-200/80 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error || customersErrorMessage}
        </div>
      )}

      {resolvingCard && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading member card...
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-4">
        {step === 'idle' && (
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="w-full rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/90 via-primary to-amber-600 p-6 text-left text-primary-foreground shadow-sm">
                <div className="mb-8 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium opacity-90">
                    <Coins className="h-4 w-4" />
                    ARK Wallet
                  </div>
                  <Nfc className="h-5 w-5 opacity-80" />
                </div>
                <div className="text-xs uppercase tracking-wide opacity-80">Available balance</div>
                <div className="mt-1 text-3xl font-bold tracking-tight">—</div>
                <div className="mt-1 text-sm opacity-80">Tap a card to load wallet</div>
              </div>
            </div>
            <div className="flex flex-col justify-center lg:col-span-7">
              <h2 className="mb-1 text-base font-semibold text-foreground">Top up e-money</h2>
              <p className="mb-6 max-w-xl text-sm text-muted-foreground">
                Tap the member NFC card on the reader, or find a customer manually.
              </p>
              <div>
                <Button
                  type="button"
                  onClick={openCustomerList}
                  disabled={resolvingCard}
                  className="bg-primary hover:bg-primary/90"
                >
                  <User className="mr-2 h-4 w-4" />
                  Find customer
                </Button>
              </div>
            </div>
          </div>
        )}

        {(step === 'enter_amount' || step === 'payment') && customer && (
          <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-5">
              <WalletCard
                customer={customer}
                highlightBalance
                projectedBalance={topupRp > 0 ? projectedBalance : undefined}
              />
            </div>

            <div className="space-y-4 lg:col-span-7">
              {step === 'enter_amount' && (
                <>
                  <section className="rounded-2xl border border-gray-200/70 bg-card p-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Top-up amount
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                      {presetValues.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => selectPreset(value)}
                          className={cn(
                            'rounded-xl border px-3 py-3 text-sm font-semibold transition-colors',
                            topupRp === value
                              ? 'border-primary/40 bg-primary/10 text-primary ring-1 ring-primary/30'
                              : 'border-gray-200/70 bg-white text-foreground hover:border-primary/30 hover:bg-primary/5'
                          )}
                        >
                          <div>{formatCurrency(value)}</div>
                          <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                            {formatArk(value)}
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Custom amount</label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={customRp}
                        onChange={(event) => handleCustom(event.target.value)}
                        placeholder="Minimum 10.000"
                        className="border-gray-200/80"
                      />
                    </div>
                  </section>

                  {topupRp > 0 && (
                    <div className="rounded-2xl border border-amber-200/70 bg-amber-50/80 px-4 py-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">You will receive</span>
                        <span className="font-semibold text-amber-700">{formatArk(topupRp)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Balance after top-up</span>
                        <span className="font-bold text-foreground">{formatArk(projectedBalance)}</span>
                      </div>
                    </div>
                  )}

                  <Button
                    type="button"
                    onClick={() => topupRp >= 10000 && setStep('payment')}
                    disabled={topupRp < 10000}
                    className="h-11 w-full bg-primary text-sm font-semibold hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground sm:w-auto sm:min-w-56"
                  >
                    Continue to payment
                  </Button>
                </>
              )}

              {step === 'payment' && (
                <>
                  <div className="rounded-2xl border border-gray-200/70 bg-card p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Top-up amount
                    </div>
                    <div className="mt-1 text-3xl font-bold text-foreground">{formatCurrency(topupRp)}</div>
                    <div className="mt-0.5 text-sm font-medium text-amber-600">{formatArk(topupRp)}</div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { id: 'qris' as const, icon: QrCode, label: 'QRIS', desc: 'Recorded as QRIS top-up' },
                      { id: 'credit_card' as const, icon: CreditCard, label: 'Card', desc: 'Recorded as card payment' },
                      { id: 'cash' as const, icon: Banknote, label: 'Cash', desc: 'Cash received at cashier' },
                    ].map((method) => (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => setPayment(method.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                          payment === method.id
                            ? 'border-primary/40 bg-primary/10 ring-1 ring-primary/30'
                            : 'border-gray-200/70 bg-white hover:border-primary/30 hover:bg-primary/5'
                        )}
                      >
                        <method.icon className="h-5 w-5 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-foreground">{method.label}</div>
                          <div className="text-xs text-muted-foreground">{method.desc}</div>
                        </div>
                        {payment === method.id ? <Check className="h-4 w-4 text-primary" /> : null}
                      </button>
                    ))}
                  </div>

                  <Button
                    type="button"
                    onClick={pay}
                    disabled={topupMutation.isPending}
                    className="h-11 w-full bg-primary text-sm font-semibold hover:bg-primary/90 sm:w-auto sm:min-w-56"
                  >
                    {topupMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing…
                      </>
                    ) : (
                      `Pay ${formatCurrency(topupRp)}`
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="flex h-full flex-col items-start justify-center py-16">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
            <div className="text-base font-semibold text-foreground">Processing top-up…</div>
          </div>
        )}

        {step === 'success' && customer && result && (
          <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
            <div className="space-y-4 lg:col-span-5">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-100">
                  <Check className="h-6 w-6 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">Top-up successful</h2>
                  <p className="text-sm text-muted-foreground">{formatArk(topupRp)} added to wallet</p>
                </div>
              </div>
              <WalletCard customer={customer} highlightBalance />
            </div>

            <div className="space-y-4 lg:col-span-7">
              <div className="w-full rounded-2xl border border-gray-200/70 bg-muted/40 p-4 text-left text-sm">
                <Line label="Amount paid" value={formatCurrency(topupRp)} />
                <Line label="ARK received" value={formatArk(topupRp)} />
                <Line label="Previous balance" value={formatArk(result.balance_before)} />
                <Line label="New balance" value={formatArk(result.balance_after)} strong />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-gray-200/80"
                  onClick={() => setShowReceipt(true)}
                >
                  Receipt
                </Button>
                <Button
                  type="button"
                  className="bg-primary hover:bg-primary/90"
                  onClick={newTopup}
                >
                  Top up again
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={showCustomerList} onOpenChange={(open) => !open && setShowCustomerList(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Select customer</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search name, phone, or card ID…"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                autoFocus
                className="border-gray-200/80 pl-9"
              />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {loadingCustomers ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading customers…
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">No customers found</div>
              ) : (
                filtered.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectCustomer(item)}
                    className="flex w-full items-center gap-3 rounded-xl border border-transparent p-3 text-left transition-colors hover:border-primary/20 hover:bg-primary/5"
                  >
                    <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {(item.name || item.phone).charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {item.name || 'Unnamed'}
                      </div>
                      <div className="text-xs text-muted-foreground">{item.phone}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-amber-600">{formatArk(item.ark_coin_balance)}</div>
                      <div
                        className={cn(
                          'mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize',
                          tierBadgeClass(item.membership_tier)
                        )}
                      >
                        {item.membership_tier || 'bronze'}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showReceipt} onOpenChange={(open) => !open && setShowReceipt(false)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center text-sm font-semibold">Top-up receipt</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-3 text-sm">
            <div className="border-b border-gray-200/70 pb-3 text-center">
              <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-emerald-100">
                <Check className="h-6 w-6 text-emerald-600" />
              </div>
              <div className="text-xs text-muted-foreground">Success</div>
              <div className="text-xl font-bold text-foreground">{formatArk(topupRp)}</div>
            </div>
            <Line label="Customer" value={customer?.name || customer?.phone || '-'} />
            <Line label="Amount" value={formatCurrency(topupRp)} />
            <Line label="Method" value={payment.toUpperCase()} />
            <Line label="Previous balance" value={formatArk(result?.balance_before || 0)} />
            <Line label="New balance" value={formatArk(result?.balance_after || 0)} strong />
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={() => setShowReceipt(false)}
              disabled={printingReceipt}
            >
              Close
            </Button>
            <Button
              type="button"
              className="bg-primary hover:bg-primary/90"
              onClick={handlePrintReceipt}
              disabled={!result || !customer || printingReceipt}
            >
              {printingReceipt ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Printing…
                </>
              ) : (
                <>
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CustomerSearchModal
        open={showCreateFromNfc}
        customers={modalCustomers}
        search={createSearch}
        selectedCustomerId={customer?.id ?? null}
        onSearchChange={setCreateSearch}
        onCreateCustomer={handleCreateCustomer}
        initialNfcUid={pendingNfcUid}
        onInitialNfcUidConsumed={() => setPendingNfcUid(null)}
        onSelect={(c) => {
          if (!c) {
            setShowCreateFromNfc(false);
            return;
          }
          toast.success(`Member ${c.name || c.phone} selected`);
          selectCustomer({
            id: c.id,
            name: c.name,
            phone: c.phone,
            membership_tier: c.membership_tier,
            ark_coin_balance: Number(c.ark_coin_balance || 0),
            nfc_uid: c.nfc_uid,
          });
        }}
        onClose={() => {
          setShowCreateFromNfc(false);
          setPendingNfcUid(null);
          setCreateSearch('');
        }}
      />
    </div>
  );
}

function WalletCard({
  customer,
  highlightBalance = false,
  projectedBalance,
}: {
  customer: TopupCustomer;
  highlightBalance?: boolean;
  projectedBalance?: number;
}) {
  const balance = Number(customer.ark_coin_balance || 0);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary via-primary to-amber-600 p-5 text-primary-foreground shadow-sm">
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-10 left-10 h-28 w-28 rounded-full bg-black/10" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-90">
            <Coins className="h-3.5 w-3.5" />
            ARK Wallet
          </div>
          <div className="mt-2 truncate text-lg font-bold">{customer.name || 'Unnamed member'}</div>
          <div className="mt-0.5 text-sm opacity-90">{customer.phone}</div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize',
            'bg-white/20 text-white'
          )}
        >
          {customer.membership_tier || 'bronze'}
        </span>
      </div>

      {customer.nfc_uid ? (
        <div className="relative mt-3 text-xs font-mono tracking-wide opacity-90">
          Card {customer.nfc_uid}
        </div>
      ) : null}

      <div className="relative mt-6">
        <div className="text-xs uppercase tracking-wide opacity-80">
          {highlightBalance ? 'Remaining balance' : 'Balance'}
        </div>
        <div className="mt-1 text-3xl font-bold tracking-tight">{formatArk(balance)}</div>
        <div className="mt-0.5 text-sm opacity-90">{formatCurrency(balance)}</div>
      </div>

      {typeof projectedBalance === 'number' && projectedBalance !== balance ? (
        <div className="relative mt-4 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="opacity-90">After top-up</span>
            <span className="font-bold">{formatArk(projectedBalance)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="mb-2 flex items-center justify-between last:mb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-bold text-amber-600' : 'font-medium text-foreground'}>{value}</span>
    </div>
  );
}
