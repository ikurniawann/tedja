import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "quill/dist/quill.snow.css";
import QueryProvider from "@/components/providers/query-provider";
import { ToastProvider } from "@/components/providers/toast-provider";
import { ActivityLogProvider } from "@/contexts/ActivityLogContext";
import { ErrorBoundary } from "@/components/error-boundary";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Arkiv",
  description: "Sistem ERP Terintegrasi: Talent Pool, Purchasing & Inventory Management",
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className={inter.className}>
        <ErrorBoundary>
          <QueryProvider>
            <ActivityLogProvider>
              <ToastProvider>
                {children}
              </ToastProvider>
            </ActivityLogProvider>
          </QueryProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
