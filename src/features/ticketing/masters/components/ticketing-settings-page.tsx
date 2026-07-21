"use client";

import { BandsSection } from "./bands-section";
import { GeneralSettingsSection } from "./general-settings-section";
import { PriceMatrixSection } from "./price-matrix-section";
import { SeasonsSection } from "./seasons-section";
import { TicketTypesSection } from "./ticket-types-section";

export function TicketingSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Pengaturan Tiket</h1>
        <p className="mt-1 text-sm text-gray-500">
          Master ticketing theme park: jenis tiket, kalender high season,
          matriks harga per kanal, registry gelang NFC, dan kebijakan
          operasional.
        </p>
      </div>

      <GeneralSettingsSection />
      <TicketTypesSection />
      <SeasonsSection />
      <PriceMatrixSection />
      <BandsSection />
    </div>
  );
}
