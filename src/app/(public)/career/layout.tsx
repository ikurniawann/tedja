import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Careers | Tedja Coffee",
  description:
    "Explore open roles and apply to join the Tedja Coffee team.",
};

export default function CareerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
