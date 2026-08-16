import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function call(host: string, path: string) {
  const req = new NextRequest(new URL(`https://${host}${path}`), {
    headers: { host },
  });
  const res = proxy(req);
  const rewritten = res.headers.get("x-middleware-rewrite");
  return rewritten ? new URL(rewritten).pathname : null; // null = passed through
}

const MEMBER = "member.suluinwounderland.com";
const DASH = "dashboard.suluinwounderland.com";

describe("proxy: member hostname", () => {
  test("rewrites the root to /member", () => {
    expect(call(MEMBER, "/")).toBe("/member");
  });

  test("prefixes a nested path", () => {
    expect(call(MEMBER, "/classic")).toBe("/member/classic");
  });

  // The whole portal 404s if these get prefixed: ~30 absolute calls to
  // /api/member-portal/* live in the member pages.
  test("passes /api through untouched", () => {
    expect(call(MEMBER, "/api/member-portal/me")).toBeNull();
  });

  // Links in the app emit absolute /member/... paths; prefixing twice would
  // send them to /member/member/...
  test("does not double-prefix an already-correct path", () => {
    expect(call(MEMBER, "/member/classic")).toBeNull();
  });
});

describe("proxy: other hostnames", () => {
  test("leaves the dashboard host alone", () => {
    expect(call(DASH, "/")).toBeNull();
    expect(call(DASH, "/member/classic")).toBeNull();
  });
});
