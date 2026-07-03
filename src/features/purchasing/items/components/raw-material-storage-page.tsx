import { ItemsLookupPage } from "@/modules/purchasing/components/items-lookup/ItemsLookupPage";

export function RawMaterialStoragePage() {
  return (
    <ItemsLookupPage
      lookupType="storage-conditions"
      listTitle="Storage Condition List"
      listDescription="Review storage condition code, name, description, and active status."
      addButtonLabel="Add Storage Condition"
    />
  );
}
