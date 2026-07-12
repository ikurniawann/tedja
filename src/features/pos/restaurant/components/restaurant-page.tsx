"use client";

import { PageTransition } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";

const BOARD_COLUMNS = ["Available Tables", "Active Orders", "Ready to Pay"];

export function RestaurantPage() {
  return (
    <PageTransition className="space-y-6">
      <PurchasingPageHeader
        title="Restaurant"
        description="Restaurant service board for table handoff and dine-in order flow."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {BOARD_COLUMNS.map((column) => (
          <Card key={column} className="border-gray-200/70 shadow-xs">
            <CardContent className="flex min-h-64 flex-col items-center justify-center p-6 text-center">
              <h2 className="text-base font-semibold text-foreground">
                {column}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Board coming in next task.
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageTransition>
  );
}
