"use client";

/**
 * Browser-side Postgres access via REST (/api/db/query, /api/auth/*).
 * Prefer React Query + feature API modules for new code.
 */

type Filter = { col: string; op: string; value: unknown };

class BrowserQueryBuilder implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }> {
  private schema = "public";
  private table: string;
  private action: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private selectStr = "*";
  private returningSelect: string | null = null;
  private filters: Filter[] = [];
  private orFilters: string[] = [];
  private orderBy: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;
  private rangeFromTo: [number, number] | null = null;
  private payload: unknown = null;
  private upsertConflict: string | null = null;
  private singleMode: "single" | "maybe" | null = null;
  private wantCount: "exact" | null = null;
  private headOnly = false;

  constructor(table: string, schema = "public") {
    this.table = table;
    this.schema = schema;
  }

  select(sel = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (this.action === "select") this.selectStr = sel || "*";
    else this.returningSelect = sel || "*";
    if (opts?.count) this.wantCount = opts.count;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(values: unknown) { this.action = "insert"; this.payload = values; return this; }
  update(values: unknown) { this.action = "update"; this.payload = values; return this; }
  upsert(values: unknown, opts?: { onConflict?: string }) {
    this.action = "upsert"; this.payload = values; this.upsertConflict = opts?.onConflict ?? null; return this;
  }
  delete() { this.action = "delete"; return this; }
  eq(col: string, value: unknown) { this.filters.push({ col, op: "=", value }); return this; }
  neq(col: string, value: unknown) { this.filters.push({ col, op: "<>", value }); return this; }
  gt(col: string, value: unknown) { this.filters.push({ col, op: ">", value }); return this; }
  gte(col: string, value: unknown) { this.filters.push({ col, op: ">=", value }); return this; }
  lt(col: string, value: unknown) { this.filters.push({ col, op: "<", value }); return this; }
  lte(col: string, value: unknown) { this.filters.push({ col, op: "<=", value }); return this; }
  like(col: string, value: unknown) { this.filters.push({ col, op: "LIKE", value }); return this; }
  ilike(col: string, value: unknown) { this.filters.push({ col, op: "ILIKE", value }); return this; }
  is(col: string, value: unknown) { this.filters.push({ col, op: "IS", value }); return this; }
  in(col: string, value: unknown[]) { this.filters.push({ col, op: "IN", value }); return this; }
  contains(col: string, value: unknown) { this.filters.push({ col, op: "@>", value }); return this; }
  not(col: string, op: string, value: unknown) { this.filters.push({ col, op: `NOT ${op.toUpperCase()}`, value }); return this; }
  or(expr: string) { this.orFilters.push(expr); return this; }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy.push({ col, asc: opts?.ascending !== false }); return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.rangeFromTo = [from, to]; return this; }
  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }

  private spec() {
    return {
      schema: this.schema,
      table: this.table,
      action: this.action,
      select: this.selectStr,
      returningSelect: this.returningSelect,
      filters: this.filters,
      orFilters: this.orFilters,
      orderBy: this.orderBy,
      limit: this.limitN,
      range: this.rangeFromTo,
      payload: this.payload,
      upsertConflict: this.upsertConflict,
      singleMode: this.singleMode,
      wantCount: this.wantCount,
      headOnly: this.headOnly,
    };
  }

  private async exec() {
    const res = await fetch("/api/db/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.spec()),
    });
    return res.json();
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.exec().then(onfulfilled, onrejected);
  }
}

function browserAuth() {
  return {
    async getUser() {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return { data: { user: null }, error: null };
      const json = await res.json();
      if (!json.success) return { data: { user: null }, error: null };
      return {
        data: {
          user: {
            id: json.data.id,
            email: json.data.email,
            user_metadata: { role: json.data.role, full_name: json.data.full_name },
          },
        },
        error: null,
      };
    },
    async getSession() {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return { data: { session: null }, error: null };
      const json = await res.json();
      if (!json.success) return { data: { session: null }, error: null };
      return {
        data: {
          session: {
            user: {
              id: json.data.id,
              email: json.data.email,
              user_metadata: { role: json.data.role, full_name: json.data.full_name },
            },
          },
        },
        error: null,
      };
    },
    async signInWithPassword(credentials: { email: string; password: string }) {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials),
        });
        const text = await res.text();
        let json: { error?: string; message?: string; data?: { user?: unknown; session?: unknown } } = {};
        if (text) {
          try {
            json = JSON.parse(text) as typeof json;
          } catch {
            json = { error: text.slice(0, 180) || "Login failed" };
          }
        }
        if (!res.ok) {
          return {
            data: { user: null, session: null },
            error: { message: json.error || json.message || `Login failed (${res.status})` },
          };
        }
        return {
          data: {
            user: json.data?.user,
            session: json.data?.session,
          },
          error: null,
        };
      } catch (err) {
        return {
          data: { user: null, session: null },
          error: { message: err instanceof Error ? err.message : "Login failed" },
        };
      }
    },
    async signOut() {
      await fetch("/api/auth/logout", { method: "POST" });
      return { error: null };
    },
    onAuthStateChange(cb: (event: string, session: unknown) => void) {
      fetch("/api/auth/me")
        .then((r) => r.json())
        .then((json) => {
          if (json.success) {
            // Bentuk session harus sama dengan getSession() — konsumen (mis.
            // useAuth) membaca role dari user.user_metadata.role.
            cb("SIGNED_IN", {
              user: {
                id: json.data.id,
                email: json.data.email,
                user_metadata: { role: json.data.role, full_name: json.data.full_name },
              },
            });
          } else cb("SIGNED_OUT", null);
        })
        .catch(() => cb("SIGNED_OUT", null));
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    admin: {
      listUsers: async () => ({ data: { users: [] }, error: { message: "Use server API" } }),
      createUser: async () => ({ data: { user: null }, error: { message: "Use server API" } }),
      updateUserById: async () => ({ data: { user: null }, error: { message: "Use server API" } }),
      deleteUser: async () => ({ data: {}, error: { message: "Use server API" } }),
      getUserById: async () => ({ data: { user: null }, error: { message: "Use server API" } }),
    },
  };
}

export function createBrowserClient() {
  return {
    from(table: string, schema = "public") {
      return new BrowserQueryBuilder(table, schema);
    },
    rpc(fn: string, params?: Record<string, unknown>) {
      return fetch("/api/db/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fn, params: params ?? {} }),
      }).then((r) => r.json());
    },
    auth: browserAuth(),
  };
}
