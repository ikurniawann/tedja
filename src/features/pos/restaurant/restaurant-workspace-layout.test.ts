import { describe, expect, it } from "vitest";
import { restaurantWorkspaceClass } from "./restaurant-workspace-layout";

describe("restaurantWorkspaceClass", () => {
  it("uses 800px three-column split, not lg", () => {
    const cls = restaurantWorkspaceClass(false);
    expect(cls).toContain("min-[800px]:grid-cols-[148px_minmax(0,1fr)_220px]");
    expect(cls).not.toContain("lg:grid-cols");
  });

  it("fills viewport height in immersive tablet shell", () => {
    expect(restaurantWorkspaceClass(true)).toContain("h-[calc(100dvh-4.5rem)]");
  });
});
