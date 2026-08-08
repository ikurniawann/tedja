import { ItemsLookupPage } from "@/modules/purchasing/components/items-lookup/ItemsLookupPage";

export function RawMaterialCategoriesPage() {
  return (
    <ItemsLookupPage
      lookupType="raw-material-categories"
      listTitle="Daftar Kategori"
      listDescription="Tinjau kode, nama, deskripsi, dan status aktif kategori."
      addButtonLabel="Tambah Kategori"
    />
  );
}
