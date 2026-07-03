"use client";

import { useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { resolveNavFrom } from "./nav-context";

function readNavFrom(pathname: string): string | null {
  if (typeof window === "undefined") return null;
  const queryFrom = new URLSearchParams(window.location.search).get("from");
  return resolveNavFrom(pathname, queryFrom);
}

/** Reads `from` query param (with session fallback) without a Suspense boundary. */
export function useNavFrom(): string | null {
  const pathname = usePathname();
  const [navFrom, setNavFrom] = useState<string | null>(() => readNavFrom(pathname));

  useLayoutEffect(() => {
    setNavFrom(readNavFrom(pathname));
  }, [pathname]);

  return navFrom;
}
