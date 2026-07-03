import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import type {
  CogsData,
  CreateProductionOrderPayload,
  ProductionDashboardData,
  ProductRecipe,
  RawMaterialRecipe,
} from "./types";

export type {
  ProductionProduct,
  CogsMaterial,
  CogsData,
  ProductionOrder,
  WipInventory,
  WipSummary,
  ProductRecipe,
  RawMaterialRecipe,
  ProductionDashboardData,
  CreateProductionOrderPayload,
} from "./types";

function productionContext(moduleType: PurchasingModuleType) {
  return moduleType === "product" ? "product" : "raw_material";
}

export async function getProductionDashboard(
  moduleType: PurchasingModuleType = "raw_material"
): Promise<ProductionDashboardData> {
  const context = productionContext(moduleType);
  const [ordersRes, itemsRes, wipRes] = await Promise.all([
    fetch(`/api/purchasing/production/orders?production_context=${context}`, { cache: "no-store" }),
    context === "product"
      ? fetch("/api/purchasing/products?limit=100&is_active=true", { cache: "no-store" })
      : fetch("/api/purchasing/production/raw-material-recipes", { cache: "no-store" }),
    fetch("/api/purchasing/production/wip", { cache: "no-store" }),
  ]);
  const [ordersJson, itemsJson, wipJson] = await Promise.all([
    ordersRes.json(),
    itemsRes.json(),
    wipRes.json(),
  ]);
  return {
    orders: ordersJson.data || [],
    products: itemsJson.data || [],
    wipInventory: wipJson.data || [],
    wipSummary: wipJson.summary || null,
  };
}

export async function getProductCogs(id: string): Promise<CogsData | null> {
  const response = await fetch(`/api/purchasing/cogs/product/${id}`, {
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || json.error || "Failed to load product COGS");
  }
  return json.data || null;
}

export async function getRawMaterialCogs(id: string): Promise<CogsData | null> {
  const response = await fetch(`/api/purchasing/cogs/raw-material/${id}`, {
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || json.error || "Failed to load raw material COGS");
  }
  return json.data || null;
}

export async function getProductionCogs(
  moduleType: PurchasingModuleType,
  id: string
): Promise<CogsData | null> {
  return moduleType === "product" ? getProductCogs(id) : getRawMaterialCogs(id);
}

export async function listRecipeProducts(): Promise<ProductRecipe[]> {
  const response = await fetch(
    "/api/purchasing/products?limit=100&is_active=true",
    { cache: "no-store" }
  );
  const json = await response.json();
  if (!response.ok) throw new Error(json.message || "Failed to load product recipes");
  return json.data || [];
}

export async function listRecipeRawMaterials(): Promise<RawMaterialRecipe[]> {
  const response = await fetch("/api/purchasing/production/raw-material-recipes", {
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.message || "Failed to load raw material recipes");
  return json.data || [];
}

export async function listRecipeItems(
  moduleType: PurchasingModuleType
): Promise<Array<ProductRecipe | RawMaterialRecipe>> {
  return moduleType === "product" ? listRecipeProducts() : listRecipeRawMaterials();
}

export interface CreateProductionOrderResult {
  ok: boolean;
  message: string;
}

export async function createProductionOrder(
  payload: CreateProductionOrderPayload
): Promise<CreateProductionOrderResult> {
  const response = await fetch("/api/purchasing/production/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  return {
    ok: response.ok,
    message: json.message || json.error || "Production order created",
  };
}

export async function getProductionOrder<T = unknown>(id: string): Promise<T> {
  const response = await fetch(`/api/purchasing/production/orders/${id}`, {
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || json.error || "Failed to load production order");
  }
  return json.data as T;
}

export interface ProductionOrderActionResult {
  ok: boolean;
  message: string;
}

export async function getRawMaterialBomEditorData(materialId: string) {
  const [materialRes, bomRes, materialsRes] = await Promise.all([
    fetch(`/api/purchasing/raw-materials/${materialId}`, { cache: "no-store" }),
    fetch(`/api/purchasing/raw-materials/${materialId}/bom`, { cache: "no-store" }),
    fetch("/api/purchasing/raw-materials?limit=200&is_active=true", { cache: "no-store" }),
  ]);

  const [materialJson, bomJson, materialsJson] = await Promise.all([
    materialRes.json(),
    bomRes.json(),
    materialsRes.json(),
  ]);

  if (!materialRes.ok) {
    throw new Error(materialJson.message || "Failed to load raw material");
  }

  return {
    material: materialJson.data,
    bom: bomJson.data || [],
    materials: (materialsJson.data || []).filter(
      (item: { id: string }) => item.id !== materialId
    ),
  };
}

export async function createRawMaterialBomItem(
  materialId: string,
  payload: { component_raw_material_id: string; qty_required: number; waste_factor: number }
) {
  const response = await fetch(`/api/purchasing/raw-materials/${materialId}/bom`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.message || "Failed to add component");
  return json.data;
}

export async function updateRawMaterialBomItem(
  id: string,
  payload: { qty_required: number; waste_factor: number }
) {
  const response = await fetch(`/api/purchasing/raw-material-bom/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.message || "Failed to update component");
  return json.data;
}

export async function deleteRawMaterialBomItem(id: string) {
  const response = await fetch(`/api/purchasing/raw-material-bom/${id}`, {
    method: "DELETE",
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.message || "Failed to remove component");
  return json;
}

export async function updateProductionOrder(
  id: string,
  payload: Record<string, unknown>
): Promise<ProductionOrderActionResult> {
  const response = await fetch(`/api/purchasing/production/orders/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  return {
    ok: response.ok,
    message: json.message || json.error || "Production status updated",
  };
}
