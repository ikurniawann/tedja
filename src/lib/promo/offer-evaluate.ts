import type { OfferType } from "@/lib/promo/offer-rules";

export type OfferCartLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
};

export type OfferEvalItem = {
  role: "component" | "buy" | "get" | "eligible";
  product_id: string;
  qty: number;
};

export type OfferEvalRule = {
  id: string;
  offer_type: OfferType;
  name: string;
  description?: string | null;
  bundle_price?: number | null;
  buy_qty?: number | null;
  get_qty?: number | null;
  get_mode?: "same_as_buy" | "specific_products" | null;
  volume_basis?: "qty" | "spend" | null;
  volume_min?: number | null;
  discount_type?: "percent" | "fixed" | null;
  discount_value?: number | null;
  items: OfferEvalItem[];
};

export type AppliedOffer = {
  rule_id: string;
  offer_type: OfferType;
  name: string;
  discount: number;
  /** BXGY: unit yang digratiskan (untuk baris FREE di cart UI) */
  free_units?: Array<{ productId: string; qty: number; unitPrice: number }>;
};

export type OfferEvalResult = {
  offer_discount: number;
  applied: AppliedOffer[];
};

function qtyByProduct(lines: OfferCartLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    const id = String(line.productId || "");
    if (!id) continue;
    const q = Math.max(0, Number(line.quantity) || 0);
    if (q <= 0) continue;
    map.set(id, (map.get(id) || 0) + q);
  }
  return map;
}

function priceByProduct(lines: OfferCartLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    const id = String(line.productId || "");
    if (!id) continue;
    // Weighted average if multiple lines of same product
    const prevQty = map.has(id) ? 1 : 0; // just store latest unit for simplicity
    void prevQty;
    const existing = map.get(id);
    if (existing == null) {
      map.set(id, Math.max(0, Number(line.unitPrice) || 0));
    } else {
      // keep max unit price (conservative for free-item valuation)
      map.set(id, Math.max(existing, Math.max(0, Number(line.unitPrice) || 0)));
    }
  }
  return map;
}

function cloneQty(src: Map<string, number>) {
  return new Map(src);
}

function consume(qtyMap: Map<string, number>, productId: string, need: number) {
  const have = qtyMap.get(productId) || 0;
  const take = Math.min(have, need);
  qtyMap.set(productId, have - take);
  return take;
}

function evalBundle(
  rule: OfferEvalRule,
  qtyMap: Map<string, number>,
  priceMap: Map<string, number>
): { discount: number; consume: Array<{ productId: string; qty: number }> } {
  const components = rule.items.filter((i) => i.role === "component");
  const bundlePrice = Math.max(0, Number(rule.bundle_price) || 0);
  if (components.length < 2 || bundlePrice <= 0) {
    return { discount: 0, consume: [] };
  }

  let sets = Infinity;
  for (const c of components) {
    const need = Math.max(0.001, Number(c.qty) || 1);
    const have = qtyMap.get(c.product_id) || 0;
    sets = Math.min(sets, Math.floor(have / need));
  }
  if (!Number.isFinite(sets) || sets <= 0) return { discount: 0, consume: [] };

  let retail = 0;
  const consumeList: Array<{ productId: string; qty: number }> = [];
  for (const c of components) {
    const perSet = Math.max(0.001, Number(c.qty) || 1);
    const used = perSet * sets;
    retail += (priceMap.get(c.product_id) || 0) * used;
    consumeList.push({ productId: c.product_id, qty: used });
  }
  const discount = Math.max(0, Math.floor(retail - bundlePrice * sets));
  return { discount, consume: consumeList };
}

function evalBxgy(
  rule: OfferEvalRule,
  qtyMap: Map<string, number>,
  priceMap: Map<string, number>
): {
  discount: number;
  consume: Array<{ productId: string; qty: number }>;
  free: Array<{ productId: string; qty: number }>;
} {
  const buyQty = Math.max(0, Math.floor(Number(rule.buy_qty) || 0));
  const getQty = Math.max(0, Math.floor(Number(rule.get_qty) || 0));
  if (buyQty <= 0 || getQty <= 0) return { discount: 0, consume: [], free: [] };

  const buyProducts = rule.items.filter((i) => i.role === "buy").map((i) => i.product_id);
  if (buyProducts.length === 0) return { discount: 0, consume: [], free: [] };

  const mode = rule.get_mode || "same_as_buy";
  let buyHave = 0;
  for (const id of buyProducts) buyHave += qtyMap.get(id) || 0;

  let times = 0;
  let freeUnits = 0;
  let paidUnits = 0;

  if (mode === "same_as_buy") {
    // Beli X gratis Y dari pool yang sama → cycle = X+Y
    const cycle = buyQty + getQty;
    times = Math.floor(buyHave / cycle);
    if (times <= 0) return { discount: 0, consume: [], free: [] };
    freeUnits = times * getQty;
    paidUnits = times * buyQty;
  } else {
    const getProducts = rule.items.filter((i) => i.role === "get").map((i) => i.product_id);
    if (getProducts.length === 0) return { discount: 0, consume: [], free: [] };
    times = Math.floor(buyHave / buyQty);
    if (times <= 0) return { discount: 0, consume: [], free: [] };
    freeUnits = times * getQty;
    paidUnits = times * buyQty;

    // Consume paid buy units
    const consumeList: Array<{ productId: string; qty: number }> = [];
    const freeList: Array<{ productId: string; qty: number }> = [];
    let buyNeed = paidUnits;
    const buyPriced = buyProducts
      .map((id) => ({ id, have: qtyMap.get(id) || 0, price: priceMap.get(id) || 0 }))
      .filter((p) => p.have > 0)
      .sort((a, b) => a.price - b.price);
    for (const b of buyPriced) {
      if (buyNeed <= 0) break;
      const take = Math.min(b.have, buyNeed);
      consumeList.push({ productId: b.id, qty: take });
      buyNeed -= take;
    }

    // Free from get pool (cheapest first)
    let remaining = freeUnits;
    let discount = 0;
    const getPriced = getProducts
      .map((id) => ({
        id,
        price: priceMap.get(id) || 0,
        have: qtyMap.get(id) || 0,
      }))
      .filter((p) => p.have > 0 && p.price > 0)
      .sort((a, b) => a.price - b.price);
    for (const p of getPriced) {
      if (remaining <= 0) break;
      const take = Math.min(p.have, remaining);
      discount += Math.floor(p.price * take);
      consumeList.push({ productId: p.id, qty: take });
      freeList.push({ productId: p.id, qty: take });
      remaining -= take;
    }
    return { discount: Math.max(0, discount), consume: consumeList, free: freeList };
  }

  // same_as_buy path
  const consumeList: Array<{ productId: string; qty: number }> = [];
  const freeList: Array<{ productId: string; qty: number }> = [];
  const pool = buyProducts
    .map((id) => ({
      id,
      price: priceMap.get(id) || 0,
      have: qtyMap.get(id) || 0,
    }))
    .filter((p) => p.have > 0)
    .sort((a, b) => a.price - b.price);

  // Reserve paid units first (most expensive paid = free cheapest)
  let payNeed = paidUnits;
  let freeNeed = freeUnits;
  // Take free from cheapest
  let discount = 0;
  for (const p of pool) {
    if (freeNeed <= 0) break;
    const take = Math.min(p.have, freeNeed);
    discount += Math.floor(p.price * take);
    consumeList.push({ productId: p.id, qty: take });
    freeList.push({ productId: p.id, qty: take });
    freeNeed -= take;
    p.have -= take;
  }
  for (const p of pool) {
    if (payNeed <= 0) break;
    const take = Math.min(p.have, payNeed);
    if (take <= 0) continue;
    consumeList.push({ productId: p.id, qty: take });
    payNeed -= take;
    p.have -= take;
  }

  return { discount: Math.max(0, discount), consume: consumeList, free: freeList };
}

function evalVolume(
  rule: OfferEvalRule,
  lines: OfferCartLine[]
): { discount: number; consume: Array<{ productId: string; qty: number }> } {
  const eligibleIds = rule.items
    .filter((i) => i.role === "eligible")
    .map((i) => i.product_id);
  const scoped =
    eligibleIds.length === 0
      ? lines
      : lines.filter((l) => eligibleIds.includes(l.productId));

  const basis = rule.volume_basis || "qty";
  const min = Math.max(0, Number(rule.volume_min) || 0);
  if (min <= 0) return { discount: 0, consume: [] };

  const totalQty = scoped.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  const totalSpend = scoped.reduce(
    (s, l) => s + Math.max(0, l.quantity) * Math.max(0, l.unitPrice),
    0
  );

  const ok = basis === "spend" ? totalSpend >= min : totalQty >= min;
  if (!ok) return { discount: 0, consume: [] };

  const type = rule.discount_type;
  const value = Number(rule.discount_value) || 0;
  if (!type || value <= 0) return { discount: 0, consume: [] };

  const base = Math.floor(totalSpend);
  let discount = 0;
  if (type === "percent") {
    discount = Math.floor((base * Math.min(100, value)) / 100);
  } else {
    discount = Math.floor(value);
  }
  discount = Math.min(discount, base);

  // Volume doesn't exclusively reserve qty for other rules in greedy pass
  return { discount, consume: [] };
}

function evalOne(
  rule: OfferEvalRule,
  lines: OfferCartLine[],
  qtyMap: Map<string, number>,
  priceMap: Map<string, number>
) {
  if (rule.offer_type === "bundle") {
    const r = evalBundle(rule, qtyMap, priceMap);
    return { ...r, free: [] as Array<{ productId: string; qty: number }> };
  }
  if (rule.offer_type === "bxgy") return evalBxgy(rule, qtyMap, priceMap);
  if (rule.offer_type === "volume") {
    const r = evalVolume(rule, lines);
    return { ...r, free: [] as Array<{ productId: string; qty: number }> };
  }
  return {
    discount: 0,
    consume: [] as Array<{ productId: string; qty: number }>,
    free: [] as Array<{ productId: string; qty: number }>,
  };
}

/**
 * Apply active offer rules to cart lines.
 * Conflict: greedy by largest discount; reserved qty prevents double-use
 * (volume does not reserve).
 */
export function evaluateOfferRules(
  lines: OfferCartLine[],
  rules: OfferEvalRule[]
): OfferEvalResult {
  const priceMap = priceByProduct(lines);
  let qtyMap = qtyByProduct(lines);
  const applied: AppliedOffer[] = [];

  const scored = rules
    .map((rule) => {
      const trialQty = cloneQty(qtyMap);
      const { discount } = evalOne(rule, lines, trialQty, priceMap);
      return { rule, discount };
    })
    .filter((r) => r.discount > 0)
    .sort((a, b) => b.discount - a.discount);

  for (const { rule } of scored) {
    const { discount, consume: used, free } = evalOne(rule, lines, qtyMap, priceMap);
    if (discount <= 0) continue;
    // Re-check with current remaining map for non-volume
    if (rule.offer_type !== "volume") {
      // ensure we can still consume
      const check = cloneQty(qtyMap);
      let ok = true;
      for (const u of used) {
        if (consume(check, u.productId, u.qty) < u.qty - 1e-9) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (const u of used) consume(qtyMap, u.productId, u.qty);
    }

    applied.push({
      rule_id: rule.id,
      offer_type: rule.offer_type,
      name: rule.name,
      discount,
      free_units: free.map((f) => ({
        productId: f.productId,
        qty: f.qty,
        unitPrice: priceMap.get(f.productId) || 0,
      })),
    });
  }

  // If multiple applied and user preference is "largest only" for conflicts,
  // we already reserved qty. Volume can still add on top.
  // Cap: if two volume rules, keep only best volume.
  const volumes = applied.filter((a) => a.offer_type === "volume");
  let filtered = applied;
  if (volumes.length > 1) {
    const bestVol = volumes.reduce((a, b) => (a.discount >= b.discount ? a : b));
    filtered = applied.filter(
      (a) => a.offer_type !== "volume" || a.rule_id === bestVol.rule_id
    );
  }

  const offer_discount = filtered.reduce((s, a) => s + a.discount, 0);
  return { offer_discount, applied: filtered };
}

/** Alokasi qty gratis ke baris cart (per productId, FIFO). */
export function allocateFreeUnitsToCartLines<
  T extends { id: string; productId: string; quantity: number },
>(
  cart: T[],
  applied: AppliedOffer[]
): Map<string, { freeQty: number; offerName: string }> {
  const remainingByProduct = new Map<string, number>();
  const offerNameByProduct = new Map<string, string>();
  for (const a of applied) {
    for (const u of a.free_units || []) {
      const id = String(u.productId || "");
      const q = Math.max(0, Math.floor(Number(u.qty) || 0));
      if (!id || q <= 0) continue;
      remainingByProduct.set(id, (remainingByProduct.get(id) || 0) + q);
      if (!offerNameByProduct.has(id)) offerNameByProduct.set(id, a.name);
    }
  }

  const out = new Map<string, { freeQty: number; offerName: string }>();
  for (const line of cart) {
    const pid = String(line.productId || "");
    const need = remainingByProduct.get(pid) || 0;
    if (need <= 0) continue;
    const take = Math.min(Math.max(0, Math.floor(line.quantity) || 0), need);
    if (take <= 0) continue;
    out.set(line.id, {
      freeQty: take,
      offerName: offerNameByProduct.get(pid) || "Promo",
    });
    remainingByProduct.set(pid, need - take);
  }
  return out;
}

export function isOfferInPeriod(
  rule: { valid_from?: string | null; valid_until?: string | null },
  todayIsoDate: string
): boolean {
  const from = rule.valid_from || null;
  const until = rule.valid_until || null;
  if (from && todayIsoDate < from) return false;
  if (until && todayIsoDate > until) return false;
  return true;
}
