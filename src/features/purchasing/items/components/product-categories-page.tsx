import { ItemsLookupPage } from "@/modules/purchasing/components/items-lookup/ItemsLookupPage";

export function ProductCategoriesPage() {
  return (
    <ItemsLookupPage
      lookupType="product-categories"
      listTitle="Product Category List"
      listDescription="Review category code, name, description, and active status."
      addButtonLabel="Add Category"
    />
  );
}
