"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  ChefHat,
  ChevronRight,
  Coins,
  Loader2,
  Minus,
  Plus,
  QrCode,
  Search,
  ShoppingBag,
  Smartphone,
  X,
  UserRound,
  WalletCards,
} from "lucide-react";

type Step = "member" | "menu" | "payment" | "success";
type PaymentMethod = "qris" | "ark_coin" | "va" | "cashier";

type MenuItem = {
  id: string;
  sku?: string;
  name: string;
  category: "Food" | "Drink" | "Dessert";
  description: string;
  price: number;
  xp: number;
  station: "Kitchen" | "Bar";
  image: string;
  variants: {
    id: string;
    name: string;
    priceAdjustment: number;
  }[];
};

type CartItem = MenuItem & {
  cartId: string;
  quantity: number;
  selectedVariant: string;
  unitPrice: number;
};

type Customer = {
  id: string;
  name: string;
  phone: string;
  membership_tier: string;
  ark_coin_balance: number;
  total_xp: number;
};

type TableSession = {
  table_id: string | null;
  table_code: string;
  table_label: string;
  table_resolved: boolean;
};

type OrderResult = {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentFlow: PaymentMethod;
  subtotal: number;
  tax: number;
  total: number;
  totalXp: number;
  items: CartItem[];
};

const menuItems: MenuItem[] = [
  {
    id: "nasi-ayam",
    sku: "DEMO-NASI-AYAM",
    name: "Nasi Ayam Sambal Matah",
    category: "Food",
    description: "Rice bowl ayam, sambal matah, telur, dan sayur.",
    price: 48000,
    xp: 48,
    station: "Kitchen",
    image: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80",
    variants: [
      { id: "regular", name: "Regular", priceAdjustment: 0 },
      { id: "large", name: "Large", priceAdjustment: 12000 },
      { id: "extra-egg", name: "Extra Egg", priceAdjustment: 7000 },
    ],
  },
  {
    id: "beef-rice",
    sku: "DEMO-BEEF",
    name: "Beef Teriyaki Bowl",
    category: "Food",
    description: "Beef slice, rice, sesame, dan house sauce.",
    price: 62000,
    xp: 62,
    station: "Kitchen",
    image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=900&q=80",
    variants: [
      { id: "regular", name: "Regular", priceAdjustment: 0 },
      { id: "large", name: "Large", priceAdjustment: 15000 },
    ],
  },
  {
    id: "latte",
    sku: "DEMO-LATTE",
    name: "Iced Aren Latte",
    category: "Drink",
    description: "Espresso, susu, aren, dan es.",
    price: 38000,
    xp: 38,
    station: "Bar",
    image: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=900&q=80",
    variants: [
      { id: "less-ice", name: "Less Ice", priceAdjustment: 0 },
      { id: "normal", name: "Normal Ice", priceAdjustment: 0 },
      { id: "oat", name: "Oat Milk", priceAdjustment: 8000 },
    ],
  },
  {
    id: "tea",
    sku: "DEMO-TEA",
    name: "Lychee Tea",
    category: "Drink",
    description: "Black tea dingin dengan lychee dan citrus.",
    price: 32000,
    xp: 32,
    station: "Bar",
    image: "https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=80",
    variants: [
      { id: "normal", name: "Normal", priceAdjustment: 0 },
      { id: "less-sugar", name: "Less Sugar", priceAdjustment: 0 },
    ],
  },
  {
    id: "cake",
    sku: "DEMO-CAKE",
    name: "Strawberry Cream Cake",
    category: "Dessert",
    description: "Slice cake lembut dengan cream dan strawberry.",
    price: 42000,
    xp: 42,
    station: "Kitchen",
    image: "https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?auto=format&fit=crop&w=900&q=80",
    variants: [
      { id: "slice", name: "Slice", priceAdjustment: 0 },
      { id: "with-ice-cream", name: "With Ice Cream", priceAdjustment: 12000 },
    ],
  },
];

const currencyFormat = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const numberFormat = new Intl.NumberFormat("id-ID");

function formatCurrency(value: number) {
  return currencyFormat.format(value);
}

function formatNumber(value: number) {
  return numberFormat.format(value);
}

function orderStatusText(status: string) {
  if (status === "pending") return "Menunggu diproses";
  if (status === "confirmed") return "Pesanan dikonfirmasi";
  if (status === "preparing") return "Sedang disiapkan";
  if (status === "ready") return "Siap diantar";
  if (status === "completed") return "Selesai";
  return status || "Menunggu diproses";
}

function paymentStatusText(status: string) {
  if (status === "paid") return "Sudah dibayar";
  if (status === "partial") return "Sebagian dibayar";
  return "Belum dibayar";
}

function paymentMethodText(method: PaymentMethod) {
  if (method === "qris") return "QRIS";
  if (method === "ark_coin") return "ARK Coin";
  if (method === "va") return "Virtual Account";
  return "Bayar di kasir";
}

export default function TableOrderPage() {
  const params = useParams<{ tableCode: string }>();
  const tableCode = decodeURIComponent(params.tableCode || "T-01").toUpperCase();
  const [step, setStep] = useState<Step>("member");
  const [phone, setPhone] = useState("");
  const [guest, setGuest] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"All" | MenuItem["category"]>("All");
  const [products, setProducts] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cashier");
  const [variantProduct, setVariantProduct] = useState<MenuItem | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [tableSession, setTableSession] = useState<TableSession | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);

  const usingFallbackMenu = products.length === 0;
  const activeProducts = usingFallbackMenu ? menuItems : products;
  const memberName = customer?.name || (phone ? "Member ARK" : "");
  const arkBalance = customer?.ark_coin_balance ?? 0;
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const tax = Math.round(subtotal * 0.1);
  const total = subtotal + tax;
  const totalXp = cart.reduce((sum, item) => sum + item.xp * item.quantity, 0);
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const canContinueMember = guest || phone.trim().length >= 8;
  const canSubmit = cart.length > 0 && !usingFallbackMenu;
  const selectedVariant = variantProduct?.variants.find((variant) => variant.id === selectedVariantId)
    ?? variantProduct?.variants[0]
    ?? null;

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return activeProducts.filter((item) => {
      const matchCategory = category === "All" || item.category === category;
      const matchQuery = !term || `${item.name} ${item.description}`.toLowerCase().includes(term);
      return matchCategory && matchQuery;
    });
  }, [activeProducts, category, query]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      setLoadingProducts(true);
      setOrderError("");

      try {
        const [sessionResponse, productsResponse] = await Promise.all([
          fetch(`/api/table-order/session/${encodeURIComponent(tableCode)}`, { cache: "no-store" }),
          fetch("/api/table-order/products", { cache: "no-store" }),
        ]);
        const [sessionJson, productsJson] = await Promise.all([
          sessionResponse.json(),
          productsResponse.json(),
        ]);

        if (!cancelled && sessionJson.success) setTableSession(sessionJson.data);
        if (!productsResponse.ok || !productsJson.success) {
          throw new Error(productsJson.error || "Gagal memuat menu");
        }
        if (!cancelled) setProducts(productsJson.data ?? []);
      } catch (error) {
        if (!cancelled) setOrderError(error instanceof Error ? error.message : "Gagal memuat menu");
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    }

    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, [tableCode]);

  function openVariantModal(item: MenuItem) {
    setVariantProduct(item);
    setSelectedVariantId(item.variants[0]?.id ?? "");
  }

  function addItem(item: MenuItem, variant = item.variants[0]) {
    const unitPrice = item.price + variant.priceAdjustment;
    const cartId = `${item.id}:${variant.id}`;
    setCart((current) => {
      const existing = current.find((cartItem) => cartItem.cartId === cartId);
      if (existing) {
        return current.map((cartItem) =>
          cartItem.cartId === cartId ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
        );
      }
      return [...current, { ...item, cartId, quantity: 1, selectedVariant: variant.name, unitPrice }];
    });
    setVariantProduct(null);
  }

  function updateQuantity(cartId: string, delta: number) {
    setCart((current) =>
      current
        .map((item) => item.cartId === cartId ? { ...item, quantity: item.quantity + delta } : item)
        .filter((item) => item.quantity > 0)
    );
  }

  async function handleMemberContinue() {
    if (!canContinueMember) return;
    setOrderError("");

    if (guest) {
      setCustomer(null);
      setStep("menu");
      return;
    }

    try {
      setSubmitting(true);
      const response = await fetch("/api/table-order/customers/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await response.json();

      if (!response.ok || !json.success) {
        throw new Error(json.error || "Gagal lookup member");
      }

      setCustomer(json.data);
      setStep("menu");
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "Gagal lookup member");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitOrder() {
    if (!canSubmit) return;
    setSubmitting(true);
    setOrderError("");

    try {
      const response = await fetch("/api/table-order/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table_code: tableCode,
          table_id: tableSession?.table_id ?? null,
          customer_id: customer?.id ?? null,
          guest_name: guest ? "Guest Customer" : undefined,
          payment_method: paymentMethod,
          items: cart.map((item) => ({
            product_id: item.id,
            product_name: item.name,
            product_sku: item.sku,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            selected_variant: item.selectedVariant,
            variant_price_adjustment: item.unitPrice - item.price,
            xp: item.xp,
            station: item.station,
          })),
          notes: `Self-service table order ${tableCode}`,
        }),
      });
      const json = await response.json();

      if (!response.ok || !json.success) {
        throw new Error(json.error || "Gagal submit order");
      }

      const createdOrderNumber = json.data?.order_number || `SELF-${tableCode}`;
      setOrderNumber(createdOrderNumber);
      setOrderResult({
        orderNumber: createdOrderNumber,
        status: String(json.data?.status || "pending"),
        paymentStatus: String(json.data?.payment_status || "unpaid"),
        paymentFlow: paymentMethod,
        subtotal,
        tax,
        total,
        totalXp,
        items: cart,
      });
      setStep("success");
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "Gagal submit order");
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    if (step === "member") void handleMemberContinue();
    if (step === "payment") void submitOrder();
  }

  function back() {
    if (step === "menu") setStep("member");
    if (step === "payment") setStep("menu");
    if (step === "success") setStep("payment");
  }

  function orderAgain() {
    setCart([]);
    setOrderError("");
    setOrderNumber("");
    setOrderResult(null);
    setPaymentMethod("cashier");
    setQuery("");
    setCategory("All");
    setStep("menu");
  }

  return (
    <main className="min-h-screen bg-pink-50 text-pink-950">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col bg-white shadow-2xl shadow-pink-950/10">
        <header className="sticky top-0 z-20 border-b border-pink-100 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg bg-pink-600 text-white">
                <ShoppingBag className="size-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-normal">ARK Table Order</h1>
                <p className="text-sm text-pink-700">Dine-in meja {tableSession?.table_label || tableCode}</p>
              </div>
            </div>
            <div className="rounded-md bg-pink-100 px-3 py-2 text-sm font-semibold text-pink-800">
              {cart.length} item
            </div>
          </div>
        </header>

        <div className="flex-1">
          <section className="min-w-0 p-4 pb-28 md:p-6 md:pb-28">
            {step === "member" && (
              <div className="mx-auto max-w-2xl">
                {orderError && (
                  <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    {orderError}
                  </div>
                )}
                <div className="rounded-lg border border-pink-100 bg-pink-50 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex size-12 items-center justify-center rounded-lg bg-pink-600 text-white">
                      <UserRound className="size-6" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold tracking-normal">Masuk member</h2>
                      <p className="text-sm text-pink-700">Masukkan nomor member atau lanjut sebagai guest.</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-lg border border-pink-100 bg-white p-5 shadow-sm">
                  <label className="block">
                    <span className="text-sm font-semibold text-pink-800">Nomor HP / member</span>
                    <input
                      value={phone}
                      onChange={(event) => {
                        setPhone(event.target.value);
                        setGuest(false);
                      }}
                      inputMode="tel"
                      className="mt-2 h-14 w-full rounded-md border border-pink-200 bg-white px-4 text-lg font-semibold text-pink-950 outline-none transition focus:border-pink-500 focus:ring-4 focus:ring-pink-500/15"
                      placeholder="08xxxxxxxxxx"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => setGuest(true)}
                    className={`mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-md border text-base font-semibold transition ${
                      guest
                        ? "border-pink-300 bg-pink-100 text-pink-900"
                        : "border-pink-200 bg-white text-pink-800 hover:bg-pink-50"
                    }`}
                  >
                    <UserRound className="size-5" />
                    Order as Guest
                  </button>

                  {(phone || guest) && (
                    <div className="mt-4 rounded-md border border-pink-100 bg-pink-50 p-4">
                      <div className="flex items-center gap-3">
                        <BadgeCheck className="size-5 text-pink-600" />
                        <div>
                          <div className="font-semibold text-pink-950">{guest ? "Guest Customer" : memberName}</div>
                          <div className="text-sm text-pink-700">
                            {guest ? "XP tidak disimpan ke member." : `${formatNumber(arkBalance)} ARK Coin tersedia · ${formatNumber(customer?.total_xp ?? 0)} XP`}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === "menu" && (
              <div>
                <div className="mb-4">
                  <h2 className="text-2xl font-semibold tracking-normal">Pilih menu</h2>
                  <p className="mt-1 text-sm text-pink-700">Dine-in otomatis untuk meja {tableSession?.table_label || tableCode}. XP tampil per produk.</p>
                  {orderError && (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                      {orderError}
                    </div>
                  )}
                  {usingFallbackMenu && !loadingProducts && (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                      Menu POS real belum berhasil dimuat. Daftar di bawah hanya preview, belum bisa dikirim sebagai order.
                    </div>
                  )}
                </div>

                <div className="sticky top-[77px] z-10 mb-4 rounded-lg border border-pink-100 bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2 rounded-md border border-pink-200 px-3">
                    <Search className="size-4 text-pink-400" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="h-11 flex-1 bg-transparent text-sm font-medium text-pink-950 outline-none"
                      placeholder="Cari menu..."
                    />
                  </div>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {(["All", "Food", "Drink", "Dessert"] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setCategory(item)}
                        className={`h-9 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition ${
                          category === item
                            ? "bg-pink-600 text-white"
                            : "bg-pink-50 text-pink-800 hover:bg-pink-100"
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                {loadingProducts ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-pink-100 bg-pink-50 px-4 py-16 text-sm font-semibold text-pink-700">
                    <Loader2 className="size-5 animate-spin" />
                    Memuat menu...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {filteredItems.map((item) => (
                    <article key={item.id} className="overflow-hidden rounded-lg border border-pink-100 bg-white shadow-sm">
                      <div
                        className="h-24 bg-cover bg-center sm:h-28"
                        style={{ backgroundImage: `url(${item.image})` }}
                      />
                      <div className="p-3">
                        <div className="space-y-2">
                          <div className="min-w-0">
                            <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-pink-950">{item.name}</h3>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">{item.description}</p>
                          </div>
                          <span className="inline-flex rounded-md bg-pink-100 px-2 py-1 text-xs font-semibold text-pink-700">
                            +{item.xp} XP
                          </span>
                        </div>
                        <div className="mt-3 flex items-end justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-pink-950">{formatCurrency(item.price)}</div>
                            <div className="text-xs font-medium text-pink-500">{item.station}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openVariantModal(item)}
                            className="inline-flex size-9 items-center justify-center rounded-md bg-pink-600 text-white shadow-sm transition hover:bg-pink-700"
                            aria-label={`Add ${item.name}`}
                          >
                            <Plus className="size-4" />
                          </button>
                        </div>
                      </div>
                    </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {step === "payment" && (
              <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_0.9fr]">
                <div>
                  <h2 className="text-2xl font-semibold tracking-normal">Summary order</h2>
                  <p className="mt-1 text-sm text-pink-700">Cek order meja {tableSession?.table_label || tableCode}, lalu pilih metode pembayaran.</p>
                  {orderError && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                      {orderError}
                    </div>
                  )}

                  <div className="mt-4 space-y-3 rounded-lg border border-pink-100 bg-white p-4 shadow-sm">
                    {cart.map((item) => (
                      <CartLine key={item.cartId} item={item} onQuantityChange={updateQuantity} />
                    ))}
                    <div className="space-y-2 border-t border-pink-100 pt-4 text-sm">
                      <Line label="Subtotal" value={formatCurrency(subtotal)} />
                      <Line label="Tax 10%" value={formatCurrency(tax)} />
                      <Line label="Earned XP" value={`+${formatNumber(totalXp)} XP`} />
                      <div className="flex items-center justify-between pt-2 text-lg font-semibold text-pink-950">
                        <span>Total</span>
                        <span>{formatCurrency(total)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold tracking-normal">Metode pembayaran</h3>
                  <div className="mt-4 grid gap-3">
                    <PaymentChoice
                      active={paymentMethod === "qris"}
                      title="QRIS"
                      description="Bayar langsung dari HP customer."
                      icon={QrCode}
                      onClick={() => setPaymentMethod("qris")}
                    />
                    <PaymentChoice
                      active={paymentMethod === "ark_coin"}
                      title="ARK Coin"
                      description={phone ? "Gunakan saldo ARK Coin member." : "Login member dibutuhkan."}
                      icon={Coins}
                      onClick={() => setPaymentMethod("ark_coin")}
                    />
                    <PaymentChoice
                      active={paymentMethod === "va"}
                      title="Virtual Account"
                      description="Generate VA untuk pembayaran mandiri."
                      icon={Smartphone}
                      onClick={() => setPaymentMethod("va")}
                    />
                    <PaymentChoice
                      active={paymentMethod === "cashier"}
                      title="Bayar di Kasir"
                      description="Order masuk sebagai unpaid/open bill."
                      icon={WalletCards}
                      onClick={() => setPaymentMethod("cashier")}
                    />
                  </div>
                </div>
              </div>
            )}

            {step === "success" && (
              <div className="mx-auto max-w-2xl">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-emerald-950">
                  <div className="flex size-14 items-center justify-center rounded-lg bg-emerald-600 text-white">
                    <CheckCircle2 className="size-8" />
                  </div>
                  <h2 className="mt-5 text-3xl font-semibold tracking-normal">Order terkirim</h2>
                  <p className="mt-2 leading-7 text-emerald-800">
                    Order dine-in meja {tableSession?.table_label || tableCode} berhasil dibuat dan masuk queue POS/KDS.
                  </p>
                  <div className="mt-5 rounded-md border border-emerald-200 bg-white p-4">
                    <div className="text-sm font-semibold text-neutral-500">Order Number</div>
                    <div className="mt-1 text-2xl font-semibold text-pink-950">{orderNumber || `SELF-${tableCode}`}</div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-emerald-200 bg-white p-4">
                      <div className="text-sm font-semibold text-neutral-500">Status Pesanan</div>
                      <div className="mt-1 text-base font-semibold text-pink-950">
                        {orderStatusText(orderResult?.status || "pending")}
                      </div>
                    </div>
                    <div className="rounded-md border border-emerald-200 bg-white p-4">
                      <div className="text-sm font-semibold text-neutral-500">Status Pembayaran</div>
                      <div className="mt-1 text-base font-semibold text-pink-950">
                        {paymentStatusText(orderResult?.paymentStatus || "unpaid")}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-md border border-emerald-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-neutral-500">Metode pembayaran</div>
                        <div className="mt-1 font-semibold text-pink-950">
                          {paymentMethodText(orderResult?.paymentFlow || paymentMethod)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-neutral-500">Total</div>
                        <div className="mt-1 text-xl font-semibold text-pink-950">
                          {formatCurrency(orderResult?.total || total)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-md border border-emerald-200 bg-white p-4">
                    <div className="text-sm font-semibold text-neutral-500">Summary transaksi</div>
                    <div className="mt-3 space-y-3">
                      {(orderResult?.items || cart).map((item) => (
                        <div key={item.cartId} className="flex items-start justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <div className="font-semibold text-pink-950">{item.name}</div>
                            <div className="mt-1 text-xs text-pink-600">
                              {item.quantity} x {item.selectedVariant} · {item.station}
                            </div>
                          </div>
                          <div className="shrink-0 font-semibold text-pink-950">
                            {formatCurrency(item.unitPrice * item.quantity)}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 space-y-2 border-t border-emerald-100 pt-4 text-sm">
                      <Line label="Subtotal" value={formatCurrency(orderResult?.subtotal || subtotal)} />
                      <Line label="Tax 10%" value={formatCurrency(orderResult?.tax || tax)} />
                      <Line label="Earned XP" value={`+${formatNumber(orderResult?.totalXp || totalXp)} XP`} />
                    </div>
                  </div>

                </div>
              </div>
            )}
            {step === "payment" && (
              <div className="mx-auto mt-4 max-w-5xl rounded-lg border border-pink-100 bg-pink-50 p-4">
                <div className="flex items-center gap-3">
                  <ChefHat className="size-5 text-pink-600" />
                  <div>
                    <div className="text-sm font-semibold text-pink-950">Kitchen & Bar routing</div>
                    <div className="mt-1 text-xs leading-5 text-pink-600">
                      Setelah backend disambungkan, item Kitchen dan Bar otomatis masuk printer/KDS sesuai station.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="sticky bottom-0 z-20 border-t border-pink-100 bg-white px-4 py-3 md:px-6">
          {step === "menu" ? (
            <button
              type="button"
              onClick={() => canSubmit && setStep("payment")}
              disabled={!canSubmit}
              className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between rounded-lg bg-pink-600 px-4 text-left text-white shadow-lg shadow-pink-600/20 transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:bg-pink-200"
            >
              <span>
                <span className="block text-sm font-semibold">{totalItems} items dalam order</span>
                <span className="block text-xs text-white/75">
                  {usingFallbackMenu ? "Menunggu menu POS real" : "Lihat summary dan pilih pembayaran"}
                </span>
              </span>
              <span className="flex items-center gap-2 text-base font-semibold">
                {formatCurrency(total)}
                <ChevronRight className="size-5" />
              </span>
            </button>
          ) : (
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
              <button
                type="button"
                onClick={back}
                disabled={step === "member"}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-pink-200 bg-white px-4 text-sm font-semibold text-pink-800 shadow-sm transition hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowLeft className="size-4" />
                Back
              </button>
              <button
                type="button"
                onClick={step === "success" ? orderAgain : next}
                disabled={submitting || (step === "member" && !canContinueMember) || (step === "payment" && !canSubmit)}
                className="inline-flex h-12 min-w-44 items-center justify-center gap-2 rounded-md bg-pink-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700 disabled:cursor-not-allowed disabled:bg-pink-200"
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {step === "payment" ? "Submit Order" : step === "success" ? "Order Lagi" : "Continue"}
                {!submitting && step !== "success" && <ChevronRight className="size-4" />}
              </button>
            </div>
          )}
        </footer>
      </div>

      {variantProduct && selectedVariant && (
        <div className="fixed inset-0 z-50 flex items-end bg-pink-950/45 p-3 backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl">
            <div
              className="h-44 bg-cover bg-center"
              style={{ backgroundImage: `url(${variantProduct.image})` }}
            />
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-pink-950">{variantProduct.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-neutral-600">{variantProduct.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setVariantProduct(null)}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md bg-pink-50 text-pink-700"
                  aria-label="Close variant modal"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <div className="text-sm font-semibold text-pink-800">Pilih varian</div>
                {variantProduct.variants.map((variant) => {
                  const selected = variant.id === selectedVariant.id;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => setSelectedVariantId(variant.id)}
                      className={`flex w-full items-center justify-between rounded-md border px-3 py-3 text-left transition ${
                        selected
                          ? "border-pink-600 bg-pink-50 text-pink-950"
                          : "border-pink-100 bg-white text-pink-800 hover:bg-pink-50"
                      }`}
                    >
                      <span className="font-semibold">{variant.name}</span>
                      <span className="text-sm font-semibold">
                        {variant.priceAdjustment > 0 ? `+${formatCurrency(variant.priceAdjustment)}` : "Included"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => addItem(variantProduct, selectedVariant)}
                className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-pink-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-pink-700"
              >
                <Plus className="size-4" />
                Add to order · {formatCurrency(variantProduct.price + selectedVariant.priceAdjustment)}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function CartLine({
  item,
  onQuantityChange,
}: {
  item: CartItem;
  onQuantityChange: (cartId: string, delta: number) => void;
}) {
  return (
    <div className="rounded-md border border-pink-100 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-pink-950">{item.name}</div>
          <div className="mt-1 text-xs text-pink-600">
            {item.selectedVariant} · {formatCurrency(item.unitPrice)} · +{item.xp} XP · {item.station}
          </div>
        </div>
        <div className="text-sm font-semibold text-pink-950">{formatCurrency(item.unitPrice * item.quantity)}</div>
      </div>
      <div className="mt-3 inline-flex items-center rounded-md border border-pink-200">
        <button
          type="button"
          onClick={() => onQuantityChange(item.cartId, -1)}
          className="flex size-9 items-center justify-center text-pink-700"
          aria-label={`Decrease ${item.name}`}
        >
          <Minus className="size-4" />
        </button>
        <span className="w-9 text-center text-sm font-semibold text-pink-950">{item.quantity}</span>
        <button
          type="button"
          onClick={() => onQuantityChange(item.cartId, 1)}
          className="flex size-9 items-center justify-center text-pink-700"
          aria-label={`Increase ${item.name}`}
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}

function PaymentChoice({
  active,
  title,
  description,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  icon: typeof QrCode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-4 text-left shadow-sm transition ${
        active ? "border-pink-600 bg-pink-600 text-white" : "border-pink-100 bg-white text-pink-950 hover:bg-pink-50"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`flex size-11 items-center justify-center rounded-md ${active ? "bg-white/10" : "bg-pink-50"}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <div className="font-semibold">{title}</div>
          <div className={`mt-1 text-sm ${active ? "text-white/70" : "text-pink-600"}`}>{description}</div>
        </div>
      </div>
    </button>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-pink-700">
      <span>{label}</span>
      <span className="font-semibold text-pink-950">{value}</span>
    </div>
  );
}
