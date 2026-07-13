"use client";

import { useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  Loader2,
  Package,
  ReceiptText,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn, PageTransition } from "@/components/motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatAmount } from "@/lib/purchasing/utils";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import type { ProfitBucket } from "../types";
import { useProfitReport } from "../queries";
import {
  ProfitCategoryBarChart,
  ProfitCompositionChart,
  ProfitDailyTrendChart,
  ProfitMarginBarChart,
} from "./profit-report-charts";

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value || 0);

const today = () => new Date().toISOString().slice(0, 10);

const firstDayOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

function MetricCard({
  title,
  value,
  helper,
  icon: Icon,
}: {
  title: string;
  value: string;
  helper: string;
  icon: typeof BarChart3;
}) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="mt-1 text-sm font-medium text-gray-500">{title}</div>
        <div className="mt-2 text-xs text-gray-400">{helper}</div>
      </CardContent>
    </Card>
  );
}

function BreakdownTableSection({
  icon: Icon,
  title,
  description,
  rows,
}: {
  icon: typeof Package;
  title: string;
  description: string;
  rows: ProfitBucket[];
}) {
  return (
    <PurchasingListSection icon={Icon} title={title} description={description}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Name</th>
              <th className="px-4 py-3 text-right font-semibold">Qty</th>
              <th className="px-4 py-3 text-right font-semibold">Revenue</th>
              <th className="px-4 py-3 text-right font-semibold">COGS</th>
              <th className="px-4 py-3 text-right font-semibold">Gross Profit</th>
              <th className="px-4 py-3 text-right font-semibold">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.label}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatNumber(row.quantity)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatAmount(row.revenue)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatAmount(row.cogs)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {formatAmount(row.gross_profit)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-primary">
                    {formatNumber(row.gross_margin_pct)}%
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  No profit data for this period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PurchasingListSection>
  );
}

export function ProfitReportPage() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth);
  const [dateTo, setDateTo] = useState(today);

  const { data: report, isLoading, isFetching, error } = useProfitReport({
    date_from: dateFrom,
    date_to: dateTo,
  });

  const loading = isLoading || isFetching;
  const errorMessage = error instanceof Error ? error.message : "";
  const summary = report?.summary;
  const breakdowns = report?.breakdowns;

  return (
    <TooltipProvider>
      <PageTransition>
        <div className="space-y-6">
          <PurchasingPageHeader
            title="POS Profit Report"
            description="Revenue, COGS, gross profit, and margin based on paid order item snapshots"
            actions={
              <div className="flex w-full flex-col gap-3 rounded-lg border border-gray-200/70 bg-white p-3 sm:flex-row sm:items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600">From</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="h-9 w-full text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 sm:w-40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600">To</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    className="h-9 w-full text-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20 sm:w-40"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="purchasing-secondary-button h-9 w-full sm:w-auto"
                  onClick={() => {
                    const current = today();
                    setDateFrom(current);
                    setDateTo(current);
                  }}
                >
                  Today
                </Button>
              </div>
            }
          />

          {errorMessage && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          {loading && !report ? (
            <div className="flex items-center justify-center gap-2 py-20 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm">Loading profit report...</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <FadeIn delay={0}>
                  <MetricCard
                    title="Revenue"
                    value={formatAmount(summary?.revenue || 0)}
                    helper={`${summary?.orders || 0} paid/completed orders`}
                    icon={WalletCards}
                  />
                </FadeIn>
                <FadeIn delay={0.05}>
                  <MetricCard
                    title="COGS"
                    value={formatAmount(summary?.cogs || 0)}
                    helper={`${summary?.items || 0} items with cost snapshot`}
                    icon={ReceiptText}
                  />
                </FadeIn>
                <FadeIn delay={0.1}>
                  <MetricCard
                    title="Gross Profit"
                    value={formatAmount(summary?.gross_profit || 0)}
                    helper={`${formatNumber(summary?.gross_margin_pct || 0)}% gross margin`}
                    icon={TrendingUp}
                  />
                </FadeIn>
                <FadeIn delay={0.15}>
                  <MetricCard
                    title="Zero Cost Items"
                    value={formatNumber(summary?.zero_cost_items || 0)}
                    helper="Revenue items with zero cost price"
                    icon={CalendarDays}
                  />
                </FadeIn>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <div className="xl:col-span-8">
                  <ProfitDailyTrendChart rows={breakdowns?.dates || []} />
                </div>
                <div className="xl:col-span-4">
                  <ProfitCompositionChart
                    revenue={summary?.revenue || 0}
                    cogs={summary?.cogs || 0}
                    grossProfit={summary?.gross_profit || 0}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <ProfitCategoryBarChart rows={breakdowns?.categories || []} title="Top Categories" />
                <ProfitMarginBarChart rows={breakdowns?.products || []} />
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <BreakdownTableSection
                  icon={Package}
                  title="Product Breakdown"
                  description="Profit contribution by product"
                  rows={breakdowns?.products || []}
                />
                <BreakdownTableSection
                  icon={BarChart3}
                  title="Category Breakdown"
                  description="Profit contribution by category"
                  rows={breakdowns?.categories || []}
                />
                <BreakdownTableSection
                  icon={ReceiptText}
                  title="Station Breakdown"
                  description="Profit contribution by kitchen station"
                  rows={breakdowns?.stations || []}
                />
                <BreakdownTableSection
                  icon={Users}
                  title="Cashier Breakdown"
                  description="Profit contribution by cashier"
                  rows={breakdowns?.cashiers || []}
                />
              </div>

              <BreakdownTableSection
                icon={CalendarDays}
                title="Daily Trend"
                description="Day-by-day revenue, COGS, and gross profit"
                rows={breakdowns?.dates || []}
              />
            </>
          )}
        </div>
      </PageTransition>
    </TooltipProvider>
  );
}
