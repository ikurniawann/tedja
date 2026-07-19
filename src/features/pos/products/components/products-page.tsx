'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Package,
  Settings2,
  Sparkles,
  Save,
  PlusCircle,
  MinusCircle,
  Trash2,
  Loader2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogPanel,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
  DialogPanelBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { PurchasingPageHeader } from '@/modules/purchasing/components/page/purchasing-page-header';
import { PurchasingListSection } from '@/modules/purchasing/components/list/PurchasingListSection';
import { formatAmount } from '@/lib/purchasing/utils';
import { PosProductThumbnail } from '@/components/pos/PosProductThumbnail';
import type { PosCatalogProduct, PosProductModifier, PosProductModifierGroup, PosProductVariant } from '../types';
import { usePosCatalogProducts } from '../queries';
import { usePatchPosProduct } from '../mutations';

const generateId = () => Math.random().toString(36).slice(2, 11);

const stationOptions = [
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bar', label: 'Bar' },
  { value: 'bakery', label: 'Bakery' },
  { value: 'dessert', label: 'Dessert' },
  { value: 'merchandise', label: 'Merchandise' },
  { value: 'photobooth', label: 'Photobooth' },
];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function inferStation(product: PosCatalogProduct) {
  const explicit = product.station;
  if (explicit) return explicit;
  if (/drink|minuman|kopi|coffee|tea|teh|juice|soda|latte|cappuccino/i.test(`${product.category} ${product.name}`)) {
    return 'bar';
  }
  if (/dessert|cake|kue|roti|bread|pastry|donut|bakery/i.test(`${product.category} ${product.name}`)) {
    return 'bakery';
  }
  return 'kitchen';
}

function formatMarginLabel(margin: number) {
  const hasFraction = Math.abs(margin % 1) > 0.001;
  return `${margin.toFixed(hasFraction ? 2 : 0)}%`;
}

function marginTone(margin: number) {
  if (margin < 0) return 'text-red-600';
  if (margin < 15) return 'text-amber-600';
  return 'text-green-600';
}

export function ProductsPage() {
  const { data: products = [], isLoading: loading, error: queryError } = usePosCatalogProducts();
  const patchProductMutation = usePatchPosProduct();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [savingProductId, setSavingProductId] = useState<string | null>(null);

  const [variantModalProduct, setVariantModalProduct] = useState<PosCatalogProduct | null>(null);
  const [variantModalData, setVariantModalData] = useState<PosProductVariant[]>([]);

  const [modifierModalProduct, setModifierModalProduct] = useState<PosCatalogProduct | null>(null);
  const [modifierModalData, setModifierModalData] = useState<PosProductModifierGroup[]>([]);
  const [localEdits, setLocalEdits] = useState<
    Record<string, Partial<Pick<PosCatalogProduct, 'variants' | 'modifierGroups' | 'hasVariants' | 'hasModifiers'>>>
  >({});

  const queryErrorMessage = queryError instanceof Error ? queryError.message : null;

  useEffect(() => {
    if (queryErrorMessage) {
      toast.error(queryErrorMessage);
    }
  }, [queryErrorMessage]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchTerm(searchQuery.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const displayProducts = useMemo(
    () => products.map((product) => (localEdits[product.id] ? { ...product, ...localEdits[product.id] } : product)),
    [products, localEdits]
  );

  const categories = useMemo(() => {
    const unique = Array.from(new Set(displayProducts.map((product) => product.category).filter(Boolean)));
    return ['All', ...unique];
  }, [displayProducts]);

  const filteredProducts = displayProducts.filter((product) => {
    const haystack = `${product.name} ${product.sku || ''}`.toLowerCase();
    const matchesSearch = !searchTerm || haystack.includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || product.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const openVariantsModal = (product: PosCatalogProduct) => {
    setVariantModalProduct(product);
    setVariantModalData(product.variants.map((variant) => ({ ...variant })));
  };

  const saveVariants = () => {
    if (!variantModalProduct) return;
    const hasActiveVariants = variantModalData.some((variant) => variant.active);
    setLocalEdits((prev) => ({
      ...prev,
      [variantModalProduct.id]: {
        variants: variantModalData,
        hasVariants: hasActiveVariants,
      },
    }));
    toast.success('Variants saved locally');
    setVariantModalProduct(null);
    setVariantModalData([]);
  };

  const addVariant = () => {
    setVariantModalData((prev) => [
      ...prev,
      { id: generateId(), name: '', sku: '', priceAdj: 0, active: true },
    ]);
  };

  const removeVariant = (id: string) => {
    setVariantModalData((prev) => prev.filter((variant) => variant.id !== id));
  };

  const updateVariant = (id: string, field: keyof PosProductVariant, value: string | number | boolean) => {
    setVariantModalData((prev) =>
      prev.map((variant) => (variant.id === id ? { ...variant, [field]: value } : variant))
    );
  };

  const openModifiersModal = (product: PosCatalogProduct) => {
    setModifierModalProduct(product);
    setModifierModalData(
      product.modifierGroups.map((group) => ({
        ...group,
        modifiers: group.modifiers.map((modifier) => ({ ...modifier })),
      }))
    );
  };

  const saveModifiers = () => {
    if (!modifierModalProduct) return;
    const hasActiveModifiers = modifierModalData.some((group) => group.active);
    setLocalEdits((prev) => ({
      ...prev,
      [modifierModalProduct.id]: {
        modifierGroups: modifierModalData,
        hasModifiers: hasActiveModifiers,
      },
    }));
    toast.success('Modifiers saved locally');
    setModifierModalProduct(null);
    setModifierModalData([]);
  };

  const addModifierGroup = () => {
    setModifierModalData((prev) => [
      ...prev,
      {
        id: generateId(),
        name: '',
        required: false,
        maxSelect: 1,
        active: true,
        modifiers: [],
      },
    ]);
  };

  const removeModifierGroup = (id: string) => {
    setModifierModalData((prev) => prev.filter((group) => group.id !== id));
  };

  const updateModifierGroup = (
    id: string,
    field: keyof PosProductModifierGroup,
    value: string | number | boolean
  ) => {
    setModifierModalData((prev) =>
      prev.map((group) => (group.id === id ? { ...group, [field]: value } : group))
    );
  };

  const addModifier = (groupId: string) => {
    setModifierModalData((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          modifiers: [
            ...group.modifiers,
            { id: generateId(), name: '', priceAdj: 0, active: true },
          ],
        };
      })
    );
  };

  const removeModifier = (groupId: string, modifierId: string) => {
    setModifierModalData((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          modifiers: group.modifiers.filter((modifier) => modifier.id !== modifierId),
        };
      })
    );
  };

  const updateModifier = (
    groupId: string,
    modifierId: string,
    field: keyof PosProductModifier,
    value: string | number | boolean
  ) => {
    setModifierModalData((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          modifiers: group.modifiers.map((modifier) =>
            modifier.id === modifierId ? { ...modifier, [field]: value } : modifier
          ),
        };
      })
    );
  };

  const toggleProductStatus = async (product: PosCatalogProduct, nextActive: boolean) => {
    if (savingProductId) return;

    setSavingProductId(product.id);
    try {
      await patchProductMutation.mutateAsync({
        id: product.id,
        payload: { is_active: nextActive },
      });
      toast.success(`Product ${nextActive ? 'activated' : 'deactivated'} successfully`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update product status'));
    } finally {
      setSavingProductId(null);
    }
  };

  const updateProductStation = async (id: string, station: string) => {
    if (savingProductId) return;

    setSavingProductId(id);
    try {
      await patchProductMutation.mutateAsync({ id, payload: { station } });
      toast.success('Station updated successfully');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update station'));
    } finally {
      setSavingProductId(null);
    }
  };

  // Produk privilege member (EPIC-011 Fase C): syarat min XP; kosong = umum
  const updateProductMinXp = async (id: string, raw: string) => {
    if (savingProductId) return;
    const minXp = raw.trim() === '' ? null : Math.max(0, Math.floor(Number(raw)) || 0) || null;

    setSavingProductId(id);
    try {
      await patchProductMutation.mutateAsync({ id, payload: { min_xp: minXp } });
      toast.success(minXp ? `Syarat member ≥ ${minXp} XP tersimpan` : 'Produk jadi umum (tanpa syarat XP)');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Gagal menyimpan syarat XP'));
    } finally {
      setSavingProductId(null);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSearchTerm('');
    setSelectedCategory('All');
  };

  const hasActiveFilters = searchQuery.trim().length > 0 || selectedCategory !== 'All';

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Products & Menu"
        description="Manage POS products, variants, modifiers, and kitchen stations."
      />

      <PurchasingListSection
        icon={Package}
        title="Product Catalog"
        description={`${filteredProducts.length} product${filteredProducts.length === 1 ? '' : 's'} shown`}
        toolbar={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search products..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-9 pl-9"
              />
            </div>
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
                className="h-9 gap-1.5"
              >
                <X className="h-3.5 w-3.5" />
                Reset
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="border-b border-gray-100 px-5 py-3">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Button
                key={category}
                type="button"
                variant={selectedCategory === category ? 'default' : 'outline'}
                size="sm"
                className="h-8"
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-gray-400">
            <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
            <p className="text-sm">Loading products...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-gray-400">
            <Package className="h-12 w-12 opacity-40" />
            <p className="text-sm">No products found</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Product</th>
                  <th className="px-4 py-3 text-left font-semibold">Category</th>
                  <th className="px-4 py-3 text-right font-semibold">Selling Price</th>
                  <th className="px-4 py-3 text-right font-semibold">Est. COGS</th>
                  <th className="px-4 py-3 text-right font-semibold">Margin</th>
                  <th className="px-4 py-3 text-left font-semibold">Station</th>
                  <th className="px-4 py-3 text-right font-semibold">Min XP</th>
                  <th className="px-4 py-3 text-center font-semibold">Variants</th>
                  <th className="px-4 py-3 text-center font-semibold">Modifiers</th>
                  <th className="px-4 py-3 text-center font-semibold">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-gray-200/70">
                          <PosProductThumbnail alt={product.name} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900">{product.name}</p>
                          <p className="text-xs text-gray-400">
                            {product.sku || product.id.slice(0, 8)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{product.category}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {formatAmount(product.price)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-pink-700">
                      {formatAmount(product.cost)}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${marginTone(product.margin)}`}>
                      {formatMarginLabel(product.margin)}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={inferStation(product)}
                        onChange={(event) => updateProductStation(product.id, event.target.value)}
                        disabled={savingProductId === product.id}
                        className="h-9 rounded-lg border border-gray-200/80 bg-white px-3 text-xs font-medium text-gray-700 outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-100 disabled:opacity-50"
                      >
                        {stationOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        min={0}
                        defaultValue={product.minXp ?? ''}
                        placeholder="—"
                        title="Syarat privilege member: minimal lifetime XP. Kosongkan utk produk umum."
                        onBlur={(event) => {
                          const raw = event.target.value;
                          const current = product.minXp === null ? '' : String(product.minXp);
                          if (raw.trim() !== current) updateProductMinXp(product.id, raw);
                        }}
                        disabled={savingProductId === product.id}
                        className="h-9 w-20 rounded-lg border border-gray-200/80 bg-white px-2 text-right text-xs font-medium text-gray-700 outline-none transition focus:border-pink-300 focus:ring-1 focus:ring-pink-100 disabled:opacity-50"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        type="button"
                        variant={product.hasVariants ? 'outline' : 'ghost'}
                        size="sm"
                        onClick={() => openVariantsModal(product)}
                        className={
                          product.hasVariants
                            ? 'border-pink-200 text-pink-700 hover:bg-pink-50'
                            : 'text-gray-600'
                        }
                      >
                        <Settings2 className="mr-1 h-3.5 w-3.5" />
                        {product.variants.length}
                      </Button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        type="button"
                        variant={product.hasModifiers ? 'outline' : 'ghost'}
                        size="sm"
                        onClick={() => openModifiersModal(product)}
                        className={
                          product.hasModifiers
                            ? 'border-green-200 text-green-700 hover:bg-green-50'
                            : 'text-gray-600'
                        }
                      >
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                        {product.modifierGroups.length}
                      </Button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center">
                        <Switch
                          checked={product.status === 'active'}
                          disabled={savingProductId === product.id}
                          onCheckedChange={(checked) => toggleProductStatus(product, checked)}
                          aria-label={`Toggle active status for ${product.name}`}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
          Est. COGS for synced products (SKU PUR-*) is calculated from the latest BOM.
        </div>
      </PurchasingListSection>

      <Dialog open={variantModalProduct !== null} onOpenChange={(open) => !open && setVariantModalProduct(null)}>
        <DialogPanel size="md">
          <DialogPanelHeader>
            <DialogPanelTitle>Manage Variants</DialogPanelTitle>
            <DialogPanelDescription>{variantModalProduct?.name}</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="max-h-[60vh] space-y-4 overflow-y-auto">
            {variantModalData.map((variant, index) => (
              <div key={variant.id} className="space-y-3 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-700">Variant {index + 1}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateVariant(variant.id, 'active', !variant.active)}
                      className={variant.active ? 'border-green-200 text-green-700' : ''}
                    >
                      {variant.active ? 'Active' : 'Inactive'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeVariant(variant.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">Name</label>
                    <Input
                      value={variant.name}
                      onChange={(event) => updateVariant(variant.id, 'name', event.target.value)}
                      placeholder="Small"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">SKU</label>
                    <Input
                      value={variant.sku}
                      onChange={(event) => updateVariant(variant.id, 'sku', event.target.value)}
                      placeholder="NF-SM"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">Price Adj.</label>
                    <Input
                      type="number"
                      value={variant.priceAdj}
                      onChange={(event) =>
                        updateVariant(variant.id, 'priceAdj', Number.parseInt(event.target.value, 10) || 0)
                      }
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  Final price: {formatAmount((variantModalProduct?.price || 0) + variant.priceAdj)}
                </p>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addVariant} className="w-full">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Variant
            </Button>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVariantModalProduct(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveVariants} className="purchasing-main-button">
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <Dialog open={modifierModalProduct !== null} onOpenChange={(open) => !open && setModifierModalProduct(null)}>
        <DialogPanel size="lg">
          <DialogPanelHeader>
            <DialogPanelTitle>Manage Modifier Groups</DialogPanelTitle>
            <DialogPanelDescription>{modifierModalProduct?.name}</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="max-h-[60vh] space-y-6 overflow-y-auto">
            {modifierModalData.map((group) => (
              <div key={group.id} className="space-y-4 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Group Name</label>
                      <Input
                        value={group.name}
                        onChange={(event) => updateModifierGroup(group.id, 'name', event.target.value)}
                        placeholder="Sugar Level"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Max Select</label>
                      <Input
                        type="number"
                        value={group.maxSelect}
                        onChange={(event) =>
                          updateModifierGroup(group.id, 'maxSelect', Number.parseInt(event.target.value, 10) || 1)
                        }
                        min="1"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Status</label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => updateModifierGroup(group.id, 'active', !group.active)}
                        className={group.active ? 'border-green-200 text-green-700' : ''}
                      >
                        {group.active ? 'Active' : 'Inactive'}
                      </Button>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeModifierGroup(group.id)}
                    className="mt-6 h-8 w-8"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={group.required}
                    onChange={(event) => updateModifierGroup(group.id, 'required', event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-pink-600"
                  />
                  Required (customer must select at least one)
                </label>

                <div className="space-y-2 border-l-2 border-gray-200/80 pl-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Modifiers</p>
                  {group.modifiers.map((modifier, modifierIndex) => (
                    <div key={modifier.id} className="flex items-center gap-2">
                      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                        <Input
                          value={modifier.name}
                          onChange={(event) =>
                            updateModifier(group.id, modifier.id, 'name', event.target.value)
                          }
                          placeholder={`Modifier ${modifierIndex + 1}`}
                        />
                        <Input
                          type="number"
                          value={modifier.priceAdj}
                          onChange={(event) =>
                            updateModifier(
                              group.id,
                              modifier.id,
                              'priceAdj',
                              Number.parseInt(event.target.value, 10) || 0
                            )
                          }
                          placeholder="Price adj."
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeModifier(group.id, modifier.id)}
                      >
                        <MinusCircle className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="ghost" size="sm" onClick={() => addModifier(group.id)}>
                    <PlusCircle className="mr-1 h-3 w-3" />
                    Add Modifier
                  </Button>
                </div>
              </div>
            ))}

            <Button type="button" variant="outline" onClick={addModifierGroup} className="w-full">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Modifier Group
            </Button>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModifierModalProduct(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveModifiers} className="purchasing-main-button">
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
