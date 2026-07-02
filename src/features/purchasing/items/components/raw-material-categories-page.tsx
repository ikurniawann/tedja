import { ItemsLookupPage } from "@/modules/purchasing/components/items-lookup/ItemsLookupPage";

export function RawMaterialCategoriesPage() {
  return (
    <ItemsLookupPage
      lookupType="raw-material-categories"
      listTitle="Category List"
      listDescription="Review category code, name, description, and active status."
      addButtonLabel="Add Category"
    />
  );
}
