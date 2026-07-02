import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  allowedDevOrigins: ["192.168.18.29", "localhost"],
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return {
      beforeFiles: [
        // ── Raw Material: master data ─────────────────────────────────────
        { source: "/dashboard/raw-material/units", destination: "/dashboard/items/units" },
        {
          source: "/dashboard/raw-material/categories",
          destination: "/dashboard/items/raw-material/categories",
        },
        {
          source: "/dashboard/raw-material/storage",
          destination: "/dashboard/items/raw-material/storage",
        },
        { source: "/dashboard/raw-material/materials", destination: "/dashboard/items/raw-materials" },
        {
          source: "/dashboard/raw-material/materials/:path*",
          destination: "/dashboard/items/raw-materials/:path*",
        },
        // ── Raw Material: inventory ─────────────────────────────────────────
        {
          source: "/dashboard/raw-material/inventory/stock",
          destination: "/dashboard/inventory/stock",
        },
        {
          source: "/dashboard/raw-material/inventory/opname",
          destination: "/dashboard/inventory/opname",
        },
        {
          source: "/dashboard/raw-material/inventory/opname/:path*",
          destination: "/dashboard/inventory/opname/:path*",
        },
        {
          source: "/dashboard/raw-material/inventory/adjustment",
          destination: "/dashboard/inventory/adjustment",
        },
        {
          source: "/dashboard/raw-material/inventory/adjustment/:path*",
          destination: "/dashboard/inventory/adjustment/:path*",
        },
        {
          source: "/dashboard/raw-material/inventory/transfers",
          destination: "/dashboard/inventory/transfers",
        },
        // ── Raw Material: purchasing (invoice before catch-all) ───────────────
        {
          source: "/dashboard/raw-material/purchasing/invoice/po/:path*",
          destination: "/dashboard/purchasing/invoice/po/:path*",
        },
        {
          source: "/dashboard/raw-material/purchasing/invoice",
          destination: "/dashboard/purchasing/vendor-payments",
        },
        {
          source: "/dashboard/raw-material/purchasing/:path*",
          destination: "/dashboard/purchasing/:path*",
        },
        // ── Raw Material: approval & production ─────────────────────────────
        {
          source: "/dashboard/raw-material/approval/:path*",
          destination: "/dashboard/purchasing/approval/:path*",
        },
        {
          source: "/dashboard/raw-material/production/:path*",
          destination: "/dashboard/purchasing/production/:path*",
        },
        // ── Product: master data ────────────────────────────────────────────
        {
          source: "/dashboard/product/units",
          destination: "/dashboard/items/product/units",
        },
        {
          source: "/dashboard/product/categories",
          destination: "/dashboard/items/product/categories",
        },
        { source: "/dashboard/product/products", destination: "/dashboard/items/products" },
        {
          source: "/dashboard/product/products/:path*",
          destination: "/dashboard/items/products/:path*",
        },
        // ── Product: inventory, purchasing, approval placeholders ───────────
        {
          source: "/dashboard/product/inventory/:path*",
          destination: "/dashboard/items/product/inventory/:path*",
        },
        {
          source: "/dashboard/product/purchasing/:path*",
          destination: "/dashboard/items/product/purchasing/:path*",
        },
        {
          source: "/dashboard/product/approval/:path*",
          destination: "/dashboard/items/product/approval/:path*",
        },
        // ── Product: production ─────────────────────────────────────────────
        {
          source: "/dashboard/product/production/:path*",
          destination: "/dashboard/purchasing/production/:path*",
        },
      ],
    };
  },
  async redirects() {
    return [
      // Raw Material legacy → canonical
      { source: "/dashboard/items/units", destination: "/dashboard/raw-material/units", permanent: false },
      {
        source: "/dashboard/items/raw-material/categories",
        destination: "/dashboard/raw-material/categories",
        permanent: false,
      },
      {
        source: "/dashboard/items/raw-material/storage",
        destination: "/dashboard/raw-material/storage",
        permanent: false,
      },
      {
        source: "/dashboard/items/raw-materials",
        destination: "/dashboard/raw-material/materials",
        permanent: false,
      },
      {
        source: "/dashboard/items/raw-materials/:path*",
        destination: "/dashboard/raw-material/materials/:path*",
        permanent: false,
      },
      {
        source: "/dashboard/inventory/stock",
        destination: "/dashboard/raw-material/inventory/stock",
        permanent: false,
      },
      {
        source: "/dashboard/inventory/opname",
        destination: "/dashboard/raw-material/inventory/opname",
        permanent: false,
      },
      {
        source: "/dashboard/inventory/opname/:path*",
        destination: "/dashboard/raw-material/inventory/opname/:path*",
        permanent: false,
      },
      {
        source: "/dashboard/inventory/adjustment",
        destination: "/dashboard/raw-material/inventory/adjustment",
        permanent: false,
      },
      {
        source: "/dashboard/inventory/adjustment/:path*",
        destination: "/dashboard/raw-material/inventory/adjustment/:path*",
        permanent: false,
      },
      {
        source: "/dashboard/inventory/transfers",
        destination: "/dashboard/raw-material/inventory/transfers",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/suppliers",
        destination: "/dashboard/raw-material/purchasing/suppliers",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/suppliers/:path*",
        destination: "/dashboard/raw-material/purchasing/suppliers/:path*",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/price-list",
        destination: "/dashboard/raw-material/purchasing/price-list",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/price-list/:path*",
        destination: "/dashboard/raw-material/purchasing/price-list/:path*",
        permanent: false,
      },
      { source: "/dashboard/purchasing/pr", destination: "/dashboard/raw-material/purchasing/pr", permanent: false },
      {
        source: "/dashboard/purchasing/pr/:path*",
        destination: "/dashboard/raw-material/purchasing/pr/:path*",
        permanent: false,
      },
      { source: "/dashboard/purchasing/po", destination: "/dashboard/raw-material/purchasing/po", permanent: false },
      {
        source: "/dashboard/purchasing/po/:path*",
        destination: "/dashboard/raw-material/purchasing/po/:path*",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/delivery",
        destination: "/dashboard/raw-material/purchasing/delivery",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/delivery/:path*",
        destination: "/dashboard/raw-material/purchasing/delivery/:path*",
        permanent: false,
      },
      { source: "/dashboard/purchasing/grn", destination: "/dashboard/raw-material/purchasing/grn", permanent: false },
      {
        source: "/dashboard/purchasing/grn/:path*",
        destination: "/dashboard/raw-material/purchasing/grn/:path*",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/returns",
        destination: "/dashboard/raw-material/purchasing/returns",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/returns/:path*",
        destination: "/dashboard/raw-material/purchasing/returns/:path*",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/vendor-payments",
        destination: "/dashboard/raw-material/purchasing/invoice",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/invoice/po/:path*",
        destination: "/dashboard/raw-material/purchasing/invoice/po/:path*",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/approval/pr",
        destination: "/dashboard/raw-material/approval/pr",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/approval/po",
        destination: "/dashboard/raw-material/approval/po",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/production/recipes",
        destination: "/dashboard/raw-material/production/recipes",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/production",
        destination: "/dashboard/raw-material/production",
        permanent: false,
      },
      {
        source: "/dashboard/purchasing/production/:path*",
        destination: "/dashboard/raw-material/production/:path*",
        permanent: false,
      },
      // Product legacy → canonical
      {
        source: "/dashboard/items/product/units",
        destination: "/dashboard/product/units",
        permanent: false,
      },
      {
        source: "/dashboard/items/product/categories",
        destination: "/dashboard/product/categories",
        permanent: false,
      },
      { source: "/dashboard/items/products", destination: "/dashboard/product/products", permanent: false },
      {
        source: "/dashboard/items/products/:path*",
        destination: "/dashboard/product/products/:path*",
        permanent: false,
      },
      {
        source: "/dashboard/items/product/inventory/:path*",
        destination: "/dashboard/product/inventory/:path*",
        permanent: false,
      },
      {
        source: "/dashboard/items/product/purchasing/:path*",
        destination: "/dashboard/product/purchasing/:path*",
        permanent: false,
      },
      {
        source: "/dashboard/items/product/approval/:path*",
        destination: "/dashboard/product/approval/:path*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
