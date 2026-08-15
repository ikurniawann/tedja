import { ItemsLookupPage } from "@/modules/purchasing/components/items-lookup/ItemsLookupPage";

export function ProductCategoriesPage() {
  return (
    <ItemsLookupPage
      lookupType="product-categories"
      listTitle="Daftar Kategori"
      listDescription="Tinjau kode, nama, deskripsi, dan status aktif kategori."
      addButtonLabel="Tambah Kategori"
    />
  );
}
