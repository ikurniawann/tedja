'use client';

import { Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search, Utensils, ShoppingBag, Table as TableIcon,
  User, X, Sparkles, Printer, CheckCircle, AlertCircle, Loader2,
} from 'lucide-react';
import { ArrowsPointingInIcon, ArrowsPointingOutIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogPanel,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
  DialogPanelBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatAmount } from '@/lib/purchasing/utils';
import {
  type Customer,
  type Product,
  type PosTable,
  openBill,
  saveCustomer,
  createSplitOrder,
} from '../api';
import { useCashierOrder, useCashierTables, useCustomerFavoriteProducts } from '../queries';
import { usePayOpenOrder } from '../mutations';
import { usePosCart } from '@/hooks/use-pos-cart';
import { usePosProducts } from '@/hooks/use-pos-products';
import { usePosCustomers, type CustomerWithDiscount } from '@/hooks/use-pos-customers';
import { usePosCheckout } from '@/hooks/use-pos-checkout';
import { usePosShift } from '@/hooks/use-pos-shift';
import { usePosOnline } from '@/hooks/use-pos-online';
import { usePosOfflineQueue } from '@/hooks/use-pos-offline';
import { POS_SHIFT_MANAGEMENT_ENABLED } from '@/lib/pos/feature-flags';
import { ShiftModal } from '@/components/pos/ShiftModal';
import { PosProductThumbnail } from '@/components/pos/PosProductThumbnail';

const CASHIER_ID = '00000000-0000-0000-0000-000000000001';
import { CartPanel } from '@/components/pos/CartPanel';
import { CustomizationModal, type SelectedCustomization } from '@/components/pos/CustomizationModal';
import { PaymentModal, type PaymentMethod } from '@/components/pos/PaymentModal';
import { NFCModal } from '@/components/pos/NFCModal';
import { CustomerSearchModal } from '@/components/pos/CustomerSearchModal';
import { printThermalReceipt, type ReceiptPayload } from '@/components/pos/PrintReceipt';
import type { SplitConfig } from '@/components/pos/SplitBillModal';
import { SplitBillModal } from '@/components/pos/SplitBillModal';
import { SplitPaymentScreen } from '@/components/pos/SplitPaymentScreen';
import {
  cashierRoute,
  type CashierPageVariant,
} from '../constants';
import { PageTransition } from '@/components/motion';
import { HelpHint } from '@/components/ui/help-hint';
import { TooltipProvider } from '@/components/ui/tooltip';

/* ─── helpers ─────────────────────────────────────────────────────── */
const formatCurrency = (value: number) => formatAmount(value);

const formatArk = (value: number) => `${(value / 1000).toLocaleString('id-ID')} ARK`;

const ARK_RATE = 1000;

const getTableDisplayName = (table?: PosTable | null) =>
  table?.label || table?.table_number || table?.name || table?.qr_code || 'Table';

const getCustomerDiscount = (tier?: string) => {
  const normalizedTier = tier?.toLowerCase();
  if (normalizedTier === 'platinum') return 15;
  if (normalizedTier === 'gold') return 10;
  if (normalizedTier === 'silver') return 5;
  return 0;
};

const withCustomerDiscount = (customer: Customer): CustomerWithDiscount => ({
  ...customer,
  discount: getCustomerDiscount(customer.membership_tier),
});

/* ─── page ────────────────────────────────────────────────────────── */
function CashierPageNewContent({ variant }: { variant: CashierPageVariant }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isFullscreen = variant === 'fullscreen';
  const homeRoute = cashierRoute(variant, searchParams);
  const paymentOrderId = searchParams.get('orderId');
  const loadedPaymentOrderRef = useRef<string | null>(null);
  const { products, categories, loading, error } = usePosProducts();
  const { customers, findCustomer, refetch: refetchCustomers } = usePosCustomers();
  const cart = usePosCart();
  const { checkout, submitting } = usePosCheckout();
  const payOpenOrderMutation = usePayOpenOrder();
  const { data: tables = [], isLoading: loadingTables, error: tablesQueryError } = useCashierTables();
  const tableError = tablesQueryError instanceof Error ? tablesQueryError.message : null;
  const { data: paymentOrder } = useCashierOrder(paymentOrderId);

  /* UI state */
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showProductSuggestions, setShowProductSuggestions] = useState(false);
  const [activeProductSuggestion, setActiveProductSuggestion] = useState(0);
  const [showTableModal, setShowTableModal] = useState(false);

  /* Customization */
  const [custom, setCustom] = useState<SelectedCustomization | null>(null);
  const [customizingProduct, setCustomizingProduct] = useState<Product | null>(null);

  /* Payment */
  const [showPayment, setShowPayment] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [payingOrderNumber, setPayingOrderNumber] = useState<string | null>(null);
  const [cashReceived, setCashReceived] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [currentArkToUse, setCurrentArkToUse] = useState(0);

  /* NFC */
  const [showNFC, setShowNFC] = useState(false);
  const [nfcInput, setNfcInput] = useState('');
  const [nfcSearching, setNfcSearching] = useState(false);
  const [nfcError, setNfcError] = useState('');

  /* Result */
  const [resultPayload, setResultPayload] = useState<ReceiptPayload | null>(null);

  /* Offline */
  const { isOnline } = usePosOnline();
  const { pendingCount, enqueue, syncQueue, refreshCount } = usePosOfflineQueue();
  const [showOfflineQueue, setShowOfflineQueue] = useState(false);
  const [lastResultType, setLastResultType] = useState<'standard' | 'offlined' | null>(null);

  /* Split Bill */
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [savingBill, setSavingBill] = useState(false);
  const [splitOrder, setSplitOrder] = useState<any | null>(null);
  const [showSplitPayment, setShowSplitPayment] = useState(false);

  /* Shift */
  const { shift, isActive: hasShift, loading: loadingShift, openShift, closeShift } = usePosShift(CASHIER_ID);
  const [showShiftModal, setShowShiftModal] = useState(false);

  const canTransact = hasShift && !loadingShift;

  const requireActiveShift = useCallback(() => {
    if (!POS_SHIFT_MANAGEMENT_ENABLED) return true;
    if (loadingShift) {
      toast.message('Checking shift status...');
      return false;
    }
    if (!hasShift) {
      toast.error('Please open a shift before starting a transaction.');
      setShowShiftModal(true);
      return false;
    }
    return true;
  }, [hasShift, loadingShift]);

  const selectedCustomer = useMemo(() => {
    if (!cart.selectedCustomerId) return null;
    return findCustomer(cart.selectedCustomerId) || null;
  }, [cart.selectedCustomerId, findCustomer]);

  const { data: favorites = [], isLoading: loadingFav } = useCustomerFavoriteProducts(
    selectedCustomer?.id,
    products
  );

  const handleCreateCustomer = useCallback(async (payload: {
    name: string;
    phone: string;
    email?: string;
    enroll_member: boolean;
  }) => {
    const response = await saveCustomer({
      name: payload.name,
      phone: payload.phone,
      email: payload.email,
      membership_tier: 'bronze',
      enroll_member: payload.enroll_member,
    });
    await refetchCustomers();
    return withCustomerDiscount(response.data);
  }, [refetchCustomers]);

  const tableById = useMemo(() => {
    return new Map(tables.map((table) => [table.id, table]));
  }, [tables]);

  const selectedTableDisplay = useMemo(() => {
    if (!cart.selectedTable) return null;
    const selected = tableById.get(cart.selectedTable);
    return selected ? getTableDisplayName(selected) : cart.selectedTable;
  }, [cart.selectedTable, tableById]);

  /* Load existing open bill when redirected from Orders */
  useEffect(() => {
    if (!paymentOrderId || !paymentOrder || loadedPaymentOrderRef.current === paymentOrderId) return;

    const order = paymentOrder;
    loadedPaymentOrderRef.current = paymentOrderId;
    cart.clearCart();
    cart.setOrderType((order.order_type as 'dine_in' | 'takeaway' | 'delivery' | 'self_order') || 'dine_in');

    (order.items || []).forEach((item, index) => {
      const qty = Number(item.quantity) || 1;
      const variants = Array.isArray(item.variants) ? item.variants : [];
      const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
      cart.addItem({
        id: item.id || `${item.product_id}-${index}`,
        productId: item.product_id,
        name: item.product_name,
        price: Number(item.total_amount || item.subtotal || item.unit_price || 0) / qty,
        quantity: qty,
        variantName: variants.map((v) => v?.name).filter(Boolean).join(', ') || undefined,
        modifierNames: modifiers.map((m) => m?.name).filter((name): name is string => Boolean(name)),
        station: item.station,
      });
    });

    cart.setTable(order.table_id || null);
    cart.setCustomer(order.customer_id || null);
    cart.setNotes(order.notes || '');
    setPayingOrderNumber(order.order_number || null);
    setPaymentMethod('cash');
    setCashReceived(String(Number(order.total_amount || 0)));
  }, [paymentOrderId, paymentOrder, cart]);

  /* Financials */
  const membershipDiscount = selectedCustomer ? selectedCustomer.discount : 0;
  const discountAmount = membershipDiscount > 0 ? Math.floor(cart.subtotal * membershipDiscount / 100) : 0;
  const afterDiscount = cart.subtotal - discountAmount;
  const taxAmount = cart.includeTax ? Math.round(afterDiscount * 0.1) : 0;
  const total = afterDiscount + taxAmount;
  const maxArkUsable = selectedCustomer ? Math.min(selectedCustomer.ark_coin_balance, total) : 0;
  const arkToUseCapped = Math.min(currentArkToUse, maxArkUsable);
  const totalAfterArk = total - arkToUseCapped;

  /* Product filter */
  const filteredProducts = useMemo(() => products.filter(p => {
    const okCat = selectedCategory === 'All' || (p.category?.name || 'Uncategorized') === selectedCategory;
    const okSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    return okCat && okSearch;
  }), [products, selectedCategory, searchTerm]);

  const productSuggestions = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return [];

    return products
      .filter((product) => {
        const name = product.name.toLowerCase();
        const sku = (product.sku || '').toLowerCase();
        return name.includes(query) || sku.includes(query);
      })
      .slice(0, 8);
  }, [products, searchTerm]);

  /* ─── Actions ──────────────────────────────────────────────────── */
  const openCustomization = useCallback((product: Product) => {
    if (!requireActiveShift()) return;

    if ((product.variants && product.variants.length > 0) || (product.modifiers && product.modifiers.length > 0)) {
      const firstVariant = product.variants?.[0]?.id ?? null;
      const defaultModifiers: Record<string, string[]> = {};
      product.modifiers?.forEach(g => {
        if (g.modifier_group.modifiers.length > 0) {
          defaultModifiers[g.modifier_group.name] = [g.modifier_group.modifiers[0].id];
        }
      });
      setCustomizingProduct(product);
      setCustom({
        product,
        selectedVariant: firstVariant,
        selectedModifiers: defaultModifiers,
        quantity: 1,
        notes: '',
      });
    } else {
      cart.addItem({
        id: product.id,
        productId: product.id,
        name: product.name,
        price: product.base_price,
        quantity: 1,
        imageUrl: product.image_url,
        station: product.station,
      });
    }
  }, [cart, requireActiveShift]);

  const selectProductFromSearch = useCallback((product: Product) => {
    openCustomization(product);
    setSearchTerm('');
    setShowProductSuggestions(false);
    setActiveProductSuggestion(0);
  }, [openCustomization]);

  const handleConfirmCustomization = useCallback(() => {
    if (!custom || !customizingProduct) return;
    if (!requireActiveShift()) return;
    const product = customizingProduct;
    const variant = product.variants?.find(v => v.id === custom.selectedVariant);
    const variantName = variant?.name;
    const modifierNames: string[] = [];
    let modifierAdj = 0;
    product.modifiers?.forEach(g => {
      const ids = custom.selectedModifiers[g.modifier_group.name] || [];
      ids.forEach(id => {
        const mod = g.modifier_group.modifiers.find(m => m.id === id);
        if (mod) { modifierNames.push(mod.name); modifierAdj += (mod.price_adjustment || 0); }
      });
    });
    const finalPrice = product.base_price + (variant?.price_adjustment || 0) + modifierAdj;
    const compositeId = `${product.id}::${variantName ?? ''}::${modifierNames.join(',')}`;
    cart.addItem({
      id: compositeId,
      productId: product.id,
      name: product.name,
      price: finalPrice,
      quantity: custom.quantity,
      variantName,
      modifierNames,
      variantPriceAdj: variant?.price_adjustment || 0,
      modifierPriceAdj: modifierAdj,
      notes: custom.notes,
      imageUrl: product.image_url,
      station: product.station,
    });
    setCustom(null);
    setCustomizingProduct(null);
  }, [custom, customizingProduct, cart, requireActiveShift]);

  const openPaymentModal = useCallback(() => {
    if (cart.items.length === 0) return;
    if (!requireActiveShift()) return;
    setShowPayment(true);
  }, [cart.items.length, requireActiveShift]);

  const processNFCCard = useCallback((cardData: string) => {
    const trimmed = cardData.trim();
    if (!trimmed) return;
    setNfcSearching(true);
    setNfcError('');
    const found = customers.find(c => c.id === trimmed || c.phone === trimmed);
    if (!found) {
      setNfcError('Card not found. Make sure the card is registered as a member.');
      setNfcSearching(false);
      setNfcInput('');
      return;
    }
    if (found.ark_coin_balance < total) {
      setNfcError(`Insufficient ARK balance. Balance: ${formatArk(found.ark_coin_balance)}, Required: ${formatArk(total)}`);
      setNfcSearching(false);
      setNfcInput('');
      return;
    }
    cart.setCustomer(found.id);
    setShowNFC(false);
    setNfcSearching(false);
    setNfcInput('');
  }, [customers, total, cart]);

  /* Checkout */
  const handleCreateOrder = useCallback(async () => {
    if (processingPayment) return;
    if (cart.items.length === 0) return;
    if (!requireActiveShift()) return;
    if (paymentMethod === 'ark_coin' && !selectedCustomer) { setShowNFC(true); return; }
    if (paymentMethod === 'cash' && (parseFloat(cashReceived) || 0) < totalAfterArk) return;

    setProcessingPayment(true);

    if (paymentOrderId) {
      const paymentMethodForApi = paymentMethod === 'credit_card' ? 'credit' : paymentMethod;
      const paidAmount = paymentMethod === 'cash' ? (parseFloat(cashReceived) || totalAfterArk) : totalAfterArk;
      try {
        const data = await payOpenOrderMutation.mutateAsync({
          orderId: paymentOrderId,
          payload: {
            status: 'completed',
            payment_status: 'paid',
            payment_method: paymentMethodForApi,
            amount_paid: paidAmount,
            ark_coins_used: paymentMethod === 'ark_coin' ? arkToUseCapped : 0,
          },
        });

        const receipt: ReceiptPayload = {
          orderId: paymentOrderId,
          orderNumber: payingOrderNumber || data.data?.order_number || paymentOrderId,
          orderType: cart.orderType,
          table: selectedTableDisplay,
          items: [...cart.items],
          notes: cart.notes,
          total: totalAfterArk,
          change: paymentMethod === 'cash' ? (parseFloat(cashReceived) || 0) - totalAfterArk : 0,
          paymentMethod,
          customerName: selectedCustomer?.name,
          discountAmount,
          taxAmount,
        };
        setResultPayload(receipt);
        setShowPayment(false);
        setLastResultType('standard');
        cart.clearCart();
        setCashReceived('');
        setPaymentMethod('cash');
        setCurrentArkToUse(0);
        loadedPaymentOrderRef.current = null;
        router.replace(homeRoute);
        setProcessingPayment(false);
        return;
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Payment failed');
        setProcessingPayment(false);
        return;
      }
    }

    if (!isOnline) {
      const cSubtotal = cart.subtotal;
      const cTotal = cart.total;
      const payload = {
        order_type: cart.orderType,
        customer_id: selectedCustomer?.id,
        cashier_id: CASHIER_ID,
        items: cart.items.map(item => ({
          product_id: item.productId,
          product_name: item.name,
          product_sku: item.productId,
          quantity: item.quantity,
          unit_price: item.price,
          subtotal: item.price * item.quantity,
          total_amount: item.price * item.quantity,
        })),
        subtotal: cSubtotal,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        total_amount: cTotal,
        payment_method: paymentMethod === 'qris' ? 'qris' : paymentMethod === 'credit_card' ? 'credit' : paymentMethod === 'ark_coin' ? 'ark_coin' : 'cash',
        amount_paid: paymentMethod === 'cash' ? (parseFloat(cashReceived) || cTotal) : cTotal,
        include_tax: cart.includeTax,
        membership_discount_pct: membershipDiscount,
        notes: cart.notes,
        ark_coins_used: paymentMethod === 'ark_coin' ? arkToUseCapped : 0,
        shift_id: shift?.id || undefined,
      };
      await enqueue(payload, 'order');
      const receipt: ReceiptPayload = {
        orderId: 'OFFLINE-' + Date.now().toString(36).toUpperCase(),
        orderNumber: 'OFFLINE-' + Date.now().toString(36).toUpperCase(),
        orderType: cart.orderType,
        table: selectedTableDisplay,
        items: [...cart.items],
        notes: cart.notes,
        total: cTotal,
        change: paymentMethod === 'cash' ? (parseFloat(cashReceived) || 0) - cTotal : 0,
        paymentMethod,
        customerName: selectedCustomer?.name,
        discountAmount,
        taxAmount,
      };
      setResultPayload(receipt);
      setShowPayment(false);
      setLastResultType('offlined');
      cart.clearCart();
      setCashReceived('');
      setPaymentMethod('cash');
      setCurrentArkToUse(0);
      await refreshCount();
      setProcessingPayment(false);
      return;
    }

    const res = await checkout({
      cart: cart.items,
      orderType: cart.orderType,
      selectedTable: cart.selectedTable,
      selectedCustomer,
      paymentMethod,
      cashReceived,
      includeTax: cart.includeTax,
      notes: cart.notes,
      arkToUse: paymentMethod === 'ark_coin' ? arkToUseCapped : 0,
      shiftId: shift?.id || null,
    });

    if (res.success) {
      const receipt: ReceiptPayload = {
        orderId: res.orderId,
        orderNumber: res.orderNumber,
        orderType: cart.orderType,
        table: selectedTableDisplay,
        items: [...cart.items],
        notes: cart.notes,
        total: res.total,
        change: res.change,
        paymentMethod,
        customerName: selectedCustomer?.name,
        discountAmount,
        taxAmount,
      };
      setResultPayload(receipt);
      setShowPayment(false);
      setLastResultType('standard');
      cart.clearCart();
      setCashReceived('');
      setPaymentMethod('cash');
      setCurrentArkToUse(0);
    } else {
      toast.error(res.error || 'Payment failed');
    }
    setProcessingPayment(false);
  }, [cart, paymentMethod, selectedCustomer, cashReceived, totalAfterArk, checkout, discountAmount, taxAmount, arkToUseCapped, isOnline, enqueue, membershipDiscount, shift, refreshCount, paymentOrderId, payingOrderNumber, router, processingPayment, selectedTableDisplay, requireActiveShift, payOpenOrderMutation]);

  /* Split Bill */
  const handleConfirmSplit = useCallback(async (config: SplitConfig) => {
    if (cart.items.length === 0) return;
    if (!requireActiveShift()) return;
    setShowSplitModal(false);

    if (!isOnline) {
      const payload = {
        order_type: cart.orderType,
        customer_id: selectedCustomer?.id,
        cashier_id: CASHIER_ID,
        server_id: undefined,
        table_id: cart.selectedTable || undefined,
        shift_id: shift?.id,
        items: cart.items.map(item => ({
          product_id: item.productId,
          product_name: item.name,
          product_sku: item.productId,
          quantity: item.quantity,
          unit_price: item.price,
          subtotal: item.price * item.quantity,
          total_amount: item.price * item.quantity,
        })),
        subtotal: cart.subtotal,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        total_amount: total,
        notes: cart.notes,
        include_tax: cart.includeTax,
        membership_discount_pct: membershipDiscount,
        splits: config.splits.map(s => ({
          label: s.label,
          subtotal: s.subtotal || 0,
          tax_amount: s.tax_amount || 0,
          discount_amount: s.discount_amount || 0,
          total_amount: s.total,
          customer_id: s.customerId,
          items: s.items,
        })),
      };
      await enqueue(payload, 'split');
      const receipt: ReceiptPayload = {
        orderId: 'OFFLINE-SPLIT-' + Date.now().toString(36).toUpperCase(),
        orderNumber: 'OFFLINE-SPLIT-' + Date.now().toString(36).toUpperCase(),
        orderType: cart.orderType,
        table: selectedTableDisplay,
        items: [...cart.items],
        notes: cart.notes,
        total,
        change: 0,
        paymentMethod,
        customerName: selectedCustomer?.name,
        discountAmount,
        taxAmount,
      };
      setResultPayload(receipt);
      setLastResultType('offlined');
      cart.clearCart();
      await refreshCount();
      return;
    }

    try {
      const res = await createSplitOrder({
        order_type: cart.orderType,
        customer_id: selectedCustomer?.id,
        cashier_id: CASHIER_ID,
        server_id: undefined,
        table_id: cart.selectedTable || undefined,
        shift_id: shift?.id,
        items: cart.items.map(item => ({
          product_id: item.productId,
          product_name: item.name,
          product_sku: item.productId,
          quantity: item.quantity,
          unit_price: item.price,
          subtotal: item.price * item.quantity,
          total_amount: item.price * item.quantity,
        })),
        subtotal: cart.subtotal,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        total_amount: total,
        notes: cart.notes,
        include_tax: cart.includeTax,
        membership_discount_pct: membershipDiscount,
        splits: config.splits.map(s => ({
          label: s.label,
          subtotal: s.subtotal || 0,
          tax_amount: s.tax_amount || 0,
          discount_amount: s.discount_amount || 0,
          total_amount: s.total,
          customer_id: s.customerId,
          items: s.items,
        })),
      });

      if (res.success && res.data) {
        setSplitOrder(res.data);
        setShowSplitPayment(true);
        cart.clearCart();
      } else {
        toast.error(res.error || 'Failed to create split order');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to create split order');
    }
  }, [cart, selectedCustomer, discountAmount, taxAmount, total, membershipDiscount, isOnline, enqueue, paymentMethod, shift, refreshCount, selectedTableDisplay, requireActiveShift]);

  const handleSplitComplete = useCallback(() => {
    setShowSplitPayment(false);
    setSplitOrder(null);
    setResultPayload(null);
  }, []);

  /* Open Bill */
  const handleOpenBill = useCallback(async () => {
    if (cart.items.length === 0) return;
    if (!requireActiveShift()) return;
    try {
      setSavingBill(true);
      const res = await openBill({
        order_type: cart.orderType as any,
        customer_id: selectedCustomer?.id,
        cashier_id: CASHIER_ID,
        server_id: undefined,
        table_id: cart.selectedTable || undefined,
        shift_id: shift?.id || undefined,
        items: cart.items.map(item => ({
          product_id: item.productId,
          product_name: item.name,
          product_sku: item.productId,
          variants: item.variantName ? [{ name: item.variantName, group: 'Size', price: item.variantPriceAdj || 0 }] : [],
          modifiers: item.modifierNames?.map((name, idx) => ({ name, group: `Option-${idx}` })) || [],
          quantity: Number(item.quantity),
          unit_price: Number(item.price - (item.variantPriceAdj || 0) - (item.modifierPriceAdj || 0)),
          variant_price_adjustment: item.variantPriceAdj || 0,
          modifier_price_adjustment: item.modifierPriceAdj || 0,
          subtotal: Number(item.price * item.quantity),
          total_amount: Number(item.price * item.quantity),
          station: item.station,
          kitchen_notes: item.notes,
        })),
        subtotal: cart.subtotal,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        total_amount: total,
        notes: cart.notes,
        membership_discount_pct: selectedCustomer?.discount || 0,
      });

      if (res.success && res.data) {
        toast.success(`Open bill saved — Order ${res.data.order_number}`);
        cart.clearCart();
      } else {
        toast.error(res.error || 'Failed to save open bill');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save open bill');
    } finally {
      setSavingBill(false);
    }
  }, [cart, selectedCustomer, discountAmount, taxAmount, total, requireActiveShift, shift]);

  /* Print helpers */
  const handlePrint = useCallback((label: 'KITCHEN' | 'BAR' | 'CUSTOMER') => {
    if (!resultPayload) return;
    printThermalReceipt(resultPayload, label);
  }, [resultPayload]);

  /* ─── Render ───────────────────────────────────────────────────── */
  const shellHeight = isFullscreen
    ? 'h-[calc(100dvh-11rem)] min-h-[560px]'
    : 'h-[calc(100dvh-14rem)] min-h-[480px]';

  return (
    <TooltipProvider>
    <PageTransition>
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-900">POS Cashier</h1>
          <p className="text-sm text-gray-500">
            {isFullscreen
              ? 'Fullscreen mode — optimized for checkout'
              : 'Process orders with the dashboard sidebar available'}
          </p>
        </div>
        {isFullscreen ? (
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
            onClick={() => router.push(cashierRoute('embedded', searchParams))}
          >
            <ArrowsPointingInIcon className="mr-2 h-4 w-4" />
            Exit Fullscreen
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
            onClick={() => router.push(cashierRoute('fullscreen', searchParams))}
          >
            <ArrowsPointingOutIcon className="mr-2 h-4 w-4" />
            Fullscreen
          </Button>
        )}
      </div>

      <div className={`flex flex-col lg:flex-row ${shellHeight} gap-4`}>
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white p-6 shadow-xs">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="font-medium text-gray-900">Loading products...</span>
          </div>
        </div>
      )}
      {error && (
        <div className="fixed right-4 top-4 z-50 rounded-xl border border-red-200/80 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-red-700">
            <X className="h-5 w-5" />
            <span className="font-medium">{error}</span>
          </div>
        </div>
      )}

      {/* LEFT PANEL */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        {/* Offline Status Bar */}
        {!isOnline && (
          <div className="flex items-center justify-between rounded-lg border border-amber-200/80 bg-amber-50/80 px-4 py-2 text-sm text-amber-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span className="font-medium">Offline mode — transactions saved locally</span>
            </div>
            <span className="text-xs opacity-75">{pendingCount} pending</span>
          </div>
        )}

        {!POS_SHIFT_MANAGEMENT_ENABLED ? null : !loadingShift && !hasShift ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
              <span className="font-medium">No active shift — open a shift to start transactions</span>
              {/* role not available in this client component without new session fetching; default copy */}
              <HelpHint helpId="pos.shift" role="default" />
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => setShowShiftModal(true)}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Open Shift
            </Button>
          </div>
        ) : null}

        {POS_SHIFT_MANAGEMENT_ENABLED && loadingShift && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50 px-4 py-2 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking shift status...
          </div>
        )}

        <div className="rounded-xl border border-gray-200/70 bg-white p-4 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            {[
              {
                key: 'dine_in',
                label: 'Dine-in',
                icon: Utensils,
                activeClass: 'border-primary bg-primary text-white shadow-sm',
                idleClass: 'border-primary/30 bg-primary/10 text-primary hover:border-primary/50 hover:bg-primary/15',
              },
              {
                key: 'takeaway',
                label: 'Takeaway',
                icon: ShoppingBag,
                activeClass: 'border-amber-500 bg-amber-500 text-white shadow-sm',
                idleClass: 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100',
              },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => {
                  cart.setOrderType(t.key as any);
                  if (t.key === 'dine_in') setShowTableModal(true);
                }}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
                  cart.orderType === t.key ? t.activeClass : t.idleClass
                }`}
              >
                <t.icon className="w-4 h-4" /> {t.label}
              </button>
            ))}
            <button
              onClick={() => setShowCustomerModal(true)}
              className={`flex min-w-[150px] items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
                selectedCustomer
                  ? 'border-violet-500 bg-violet-500 text-white shadow-sm hover:bg-violet-600'
                  : 'border-violet-200/80 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100'
              }`}
            >
              <User className="h-4 w-4" />
              <span>
                {selectedCustomer?.name ? selectedCustomer.name.split(' ')[0] : 'Find Customer'}
              </span>
            </button>
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                type="text"
                placeholder="Search products..."
                value={searchTerm}
                onChange={e => {
                  setSearchTerm(e.target.value);
                  setShowProductSuggestions(true);
                  setActiveProductSuggestion(0);
                }}
                onFocus={() => setShowProductSuggestions(true)}
                onBlur={() => {
                  window.setTimeout(() => setShowProductSuggestions(false), 120);
                }}
                onKeyDown={(e) => {
                  if (!showProductSuggestions || productSuggestions.length === 0) return;

                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveProductSuggestion((current) => Math.min(current + 1, productSuggestions.length - 1));
                    return;
                  }

                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveProductSuggestion((current) => Math.max(current - 1, 0));
                    return;
                  }

                  if (e.key === 'Enter') {
                    e.preventDefault();
                    selectProductFromSearch(productSuggestions[activeProductSuggestion] || productSuggestions[0]);
                    return;
                  }

                  if (e.key === 'Escape') {
                    setShowProductSuggestions(false);
                  }
                }}
                className="h-10 pl-10 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20"
              />
              {showProductSuggestions && searchTerm.trim() && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-80 overflow-y-auto rounded-xl border border-gray-200/70 bg-white p-1 shadow-lg">
                  {productSuggestions.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-gray-500">No products found</div>
                  ) : (
                    productSuggestions.map((product, index) => {
                      const hasOptions = Boolean(product.variants?.length || product.modifiers?.length);

                      return (
                        <button
                          key={product.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectProductFromSearch(product)}
                          onMouseEnter={() => setActiveProductSuggestion(index)}
                          className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                            index === activeProductSuggestion ? 'bg-primary/10' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-900">{product.name}</div>
                            <div className="text-xs text-gray-500">
                              {product.category?.name || 'Uncategorized'} · {formatCurrency(product.base_price)}
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                            hasOptions ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {hasOptions ? 'Options' : 'Add'}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Selected Customer */}
        {selectedCustomer && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-gradient-to-r from-primary/5 to-amber-50 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {selectedCustomer.name?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{selectedCustomer.name}</div>
              <div className="text-xs text-gray-600 flex items-center gap-2">
                <span className="capitalize">{selectedCustomer.membership_tier}</span>
                <span className="text-gray-300">•</span>
                <span className="font-medium text-green-600">{selectedCustomer.discount}% off</span>
                <HelpHint helpId="pos.discount" role="default" />
                <span className="text-gray-300">•</span>
                <span className="text-amber-600 font-medium">{formatArk(selectedCustomer.ark_coin_balance)}</span>
              </div>
            </div>
            <button onClick={() => cart.setCustomer(null)} className="p-1 text-gray-400 hover:text-red-600 transition-colors"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Favorites */}
        {favorites.length > 0 && (
          <div className="rounded-xl border border-amber-100/80 bg-gradient-to-r from-amber-50 to-orange-50 p-3">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-semibold text-amber-700">
                {selectedCustomer?.name?.split(' ')[0]}&apos;s favorites
              </span>
              <span className="text-xs text-amber-600">({favorites.length} items)</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {favorites.map(product => (
                <button key={product.id} onClick={() => openCustomization(product)} className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-white p-2 text-left transition-all hover:border-amber-400 hover:bg-amber-50">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                    <PosProductThumbnail
                      src={product.image_url}
                      alt={product.name}
                      iconClassName="h-4 w-4"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-900 truncate">{product.name}</div>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-xs text-primary font-semibold">{formatCurrency(product.base_price)}</span>
                      <span className="text-[10px] text-amber-600 font-medium">{formatArk(product.base_price)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Categories */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selectedCategory === cat ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-9">
            {filteredProducts.map(product => {
              const xp = product.xp ?? ((Math.abs(product.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 100) + 1);
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => openCustomization(product)}
                  className="group flex flex-col overflow-hidden rounded-lg border border-gray-200/70 bg-white text-left transition-all hover:border-primary/50 hover:shadow-sm"
                >
                  <div className="aspect-[5/4] w-full overflow-hidden bg-gray-100">
                    <PosProductThumbnail src={product.image_url} alt={product.name} />
                  </div>
                  <div className="flex flex-col gap-0.5 p-1.5">
                    <div className="line-clamp-2 text-[11px] font-medium leading-tight text-gray-900">
                      {product.name}
                    </div>
                    <div className="text-[11px] font-bold text-primary">{formatCurrency(product.base_price)}</div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[9px] font-medium text-amber-600">{formatArk(product.base_price)}</span>
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-purple-600">
                        <Sparkles className="h-2.5 w-2.5" />
                        +{xp}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* RIGHT PANEL — Cart */}
      <CartPanel
        cart={cart.items}
        orderType={cart.orderType}
        selectedTable={selectedTableDisplay}
        subtotal={cart.subtotal}
        discountAmount={discountAmount}
        selectedCustomer={selectedCustomer}
        includeTax={cart.includeTax}
        tax={taxAmount}
        arkToUseCapped={arkToUseCapped}
        paymentMethod={paymentMethod}
        totalAfterArk={totalAfterArk}
        total={total}
        formatCurrency={formatCurrency}
        formatArk={formatArk}
        setIncludeTax={cart.setIncludeTax}
        setShowPaymentModal={openPaymentModal}
        onOpenBill={handleOpenBill}
        isSavingBill={savingBill}
        canTransact={canTransact}
        onOpenShift={POS_SHIFT_MANAGEMENT_ENABLED ? () => setShowShiftModal(true) : undefined}
        updateQuantity={cart.updateQty}
        removeFromCart={cart.removeItem}
      />

      {/* ── Customer Modal ── */}
      <CustomerSearchModal
        open={showCustomerModal}
        customers={customers}
        search={customerSearch}
        selectedCustomerId={cart.selectedCustomerId}
        onSearchChange={setCustomerSearch}
        onCreateCustomer={handleCreateCustomer}
        onSelect={(c) => { cart.setCustomer(c?.id ?? null); setShowCustomerModal(false); setCustomerSearch(''); }}
        onClose={() => setShowCustomerModal(false)}
      />

      {/* ── Table Modal ── */}
      <Dialog open={showTableModal} onOpenChange={setShowTableModal}>
        <DialogPanel
          size="2xl"
          className="!h-[88vh] !w-[calc(100vw-24px)] !max-w-none sm:!max-w-none"
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Select Table</DialogPanelTitle>
            <DialogPanelDescription>Dine-in service</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="flex min-h-0 flex-col">
            {loadingTables ? (
              <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading tables...
              </div>
            ) : tableError ? (
              <div className="rounded-lg border border-red-200/80 bg-red-50 p-4 text-sm font-medium text-red-600">
                {tableError}
              </div>
            ) : tables.length === 0 ? (
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/80 p-4 text-sm text-gray-500">
                No active tables available.
              </div>
            ) : (
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
                {tables.map((table) => {
                  const isSelected = cart.selectedTable === table.id;
                  const isOccupied = table.status === 'occupied' && !isSelected;
                  const activeOrder = table.active_order?.order_number;

                  return (
                    <button
                      key={table.id}
                      type="button"
                      disabled={isOccupied}
                      onClick={() => {
                        cart.setTable(isSelected ? null : table.id);
                        setShowTableModal(false);
                      }}
                      className={`min-h-[92px] rounded-lg border px-4 py-4 text-left transition-all ${
                        isSelected
                          ? 'border-primary bg-primary text-white shadow-sm'
                          : isOccupied
                            ? 'cursor-not-allowed border-gray-200/70 bg-gray-100 text-gray-400'
                            : 'border-gray-200/70 bg-white text-gray-800 hover:border-primary/50 hover:bg-primary/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold tracking-normal">{getTableDisplayName(table)}</span>
                        <TableIcon className="h-5 w-5 shrink-0" />
                      </div>
                      <div className={`mt-3 text-xs font-semibold ${isSelected ? 'text-primary-foreground/70' : isOccupied ? 'text-gray-400' : 'text-gray-500'}`}>
                        {isOccupied ? activeOrder || 'Occupied' : `${table.capacity} seats`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </DialogPanelBody>
        </DialogPanel>
      </Dialog>

      {/* ── Customization Modal ── */}
      <CustomizationModal
        open={!!custom}
        product={customizingProduct}
        value={custom}
        onChange={setCustom}
        onConfirm={handleConfirmCustomization}
        onCancel={() => { setCustom(null); setCustomizingProduct(null); }}
        formatCurrency={formatCurrency}
        formatArk={formatArk}
      />

      {/* ── Payment Modal ── */}
      <PaymentModal
        open={showPayment}
        total={total}
        totalAfterArk={totalAfterArk}
        selectedCustomer={selectedCustomer}
        onClose={() => setShowPayment(false)}
        submitting={processingPayment || submitting}
        onConfirm={async ({ method, cashReceived, arkToUse }) => {
          setPaymentMethod(method);
          setCashReceived(cashReceived);
          setCurrentArkToUse(arkToUse);
          await handleCreateOrder();
        }}
        formatCurrency={formatCurrency}
        formatArk={formatArk}
        onTapNFC={() => setShowNFC(true)}
      />

      {/* ── NFC Modal ── */}
      <NFCModal
        open={showNFC}
        input={nfcInput}
        searching={nfcSearching}
        error={nfcError}
        onInputChange={setNfcInput}
        onSubmit={() => processNFCCard(nfcInput)}
        onCancel={() => { setShowNFC(false); setNfcInput(''); setNfcError(''); }}
      />

      {/* ── Result Modal ── */}
      <Dialog open={!!resultPayload} onOpenChange={() => setResultPayload(null)}>
        <DialogPanel size="sm" showCloseButton={false}>
          {resultPayload && (
            <>
              <DialogPanelBody className="space-y-6 text-center">
                {lastResultType === 'offlined' ? (
                  <>
                    <AlertCircle className="mx-auto h-16 w-16 text-amber-500" />
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">Saved Offline</h2>
                      <p className="mt-1 text-sm text-gray-500">
                        Order will sync when connection is restored.
                      </p>
                    </div>
                    <div className="space-y-2 rounded-xl border border-amber-100/80 bg-amber-50/80 p-4 text-left">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Order ID</span>
                        <span className="font-bold text-gray-900">{resultPayload.orderNumber}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Total</span>
                        <span className="font-bold text-gray-900">{formatCurrency(resultPayload.total)}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">Payment Successful</h2>
                      <p className="mt-1 text-sm text-gray-500">
                        Order #{resultPayload.orderNumber?.slice(-8).toUpperCase() || resultPayload.orderId?.slice(-8).toUpperCase()}
                      </p>
                    </div>
                    <div className="space-y-2 rounded-xl border border-gray-200/70 bg-gray-50/80 p-4 text-left">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Amount Paid</span>
                        <span className="font-bold text-gray-900">{formatCurrency(resultPayload.total)}</span>
                      </div>
                      {resultPayload.change > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Change</span>
                          <span className="font-bold text-green-600">{formatCurrency(resultPayload.change)}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handlePrint('KITCHEN')}
                    className="border-orange-200/80 text-orange-600 hover:bg-orange-50"
                  >
                    <Printer className="mr-1.5 h-4 w-4" /> Kitchen
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handlePrint('BAR')}
                    className="border-primary/30 text-primary hover:bg-primary/10"
                  >
                    <Printer className="mr-1.5 h-4 w-4" /> Bar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handlePrint('CUSTOMER')}
                    className="border-purple-200/80 text-purple-600 hover:bg-purple-50"
                  >
                    <Printer className="mr-1.5 h-4 w-4" /> Receipt
                  </Button>
                </div>
              </DialogPanelBody>
              <DialogFooter>
                <Button
                  type="button"
                  onClick={() => setResultPayload(null)}
                  className="w-full bg-primary hover:bg-primary/90 sm:w-auto"
                >
                  New Transaction
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogPanel>
      </Dialog>

      {/* ── Offline Queue Modal ── */}
      <Dialog open={showOfflineQueue} onOpenChange={setShowOfflineQueue}>
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Offline Queue</DialogPanelTitle>
            <DialogPanelDescription>{pendingCount} orders waiting to sync</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowOfflineQueue(false)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={!isOnline || pendingCount === 0}
              onClick={async () => {
                const { synced, failed } = await syncQueue();
                toast.success(`Sync complete: ${synced} succeeded, ${failed} failed`);
              }}
              className="bg-primary hover:bg-primary/90"
            >
              Sync Now
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      {/* ── Shift Modal ── */}
      {POS_SHIFT_MANAGEMENT_ENABLED ? (
        <ShiftModal
          open={showShiftModal}
          shift={shift}
          onClose={() => setShowShiftModal(false)}
          onOpenShift={openShift}
          onCloseShift={closeShift}
          formatCurrency={formatCurrency}
        />
      ) : null}

      {/* ── Split Bill Modal ── */}
      <SplitBillModal
        open={showSplitModal}
        total={total}
        subtotal={cart.subtotal}
        taxAmount={taxAmount}
        discountAmount={discountAmount}
        cartItems={cart.items}
        onClose={() => setShowSplitModal(false)}
        onConfirm={handleConfirmSplit}
        formatCurrency={formatCurrency}
      />

      {/* ── Split Payment Screen (overlay) ── */}
      {showSplitPayment && splitOrder && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col p-4 lg:p-6">
          <SplitPaymentScreen
            orderId={splitOrder.id}
            orderNumber={splitOrder.order_number}
            orderType={splitOrder.order_type}
            table={splitOrder.table_id ? getTableDisplayName(tableById.get(splitOrder.table_id)) : null}
            items={splitOrder.items || []}
            notes={splitOrder.notes}
            total={total}
            taxAmount={taxAmount}
            discountAmount={discountAmount}
            customerName={selectedCustomer?.name}
            onBack={() => setShowSplitPayment(false)}
            onComplete={handleSplitComplete}
            formatCurrency={formatCurrency}
            formatArk={formatArk}
          />
        </div>
      )}
      </div>
    </div>
    </PageTransition>
    </TooltipProvider>
  );
}

export function CashierPage({ variant = 'embedded' }: { variant?: CashierPageVariant }) {
  return (
    <Suspense fallback={
      <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading cashier...
      </div>
    }>
      <CashierPageNewContent variant={variant} />
    </Suspense>
  );
}
