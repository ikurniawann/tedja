FROM node:22-alpine AS deps
WORKDIR /app
# corepack ships with node:22; pinning the version here keeps CI byte-identical
# to local installs without adding a "packageManager" field to package.json.
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# Only the manifest + lockfile + .npmrc, so this layer (the slow one) is reused
# from --cache-from on every build where dependencies didn't change.
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
# NEXT_PUBLIC_* are read from the .env the CI build job renders out of
# RUNTIME_CONFIG_CONTENT and inlined into the client bundle right here — see
# the note in .dockerignore about why .env must NOT be excluded.
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# output: "standalone" (next.config.ts) emits a self-contained server.js plus
# only the traced node_modules files. No package manager and no
# devDependencies in the runtime image. static/ and public/ are deliberately
# NOT part of standalone and have to be copied alongside it.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Aplikasi menulis unggahan ke process.cwd()/storage (lihat src/lib/storage.ts dan
# src/lib/storage-private.ts). /app milik root sedangkan proses berjalan sebagai
# nextjs, jadi mkdir saat runtime gagal dengan EACCES — direktorinya harus dibuat
# di sini, selagi masih root. Isinya sendiri dipasok lewat volume saat docker run;
# tanpa volume, unggahan hilang setiap redeploy.
RUN mkdir -p /app/storage/uploads /app/storage/private && \
    chown -R nextjs:nodejs /app/storage

EXPOSE 3000
ENV PORT=3000
# The standalone server binds HOSTNAME, defaulting to localhost — inside a
# container that makes the published port unreachable. Must be 0.0.0.0.
ENV HOSTNAME=0.0.0.0
USER nextjs
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -q -O- http://localhost:3000 >/dev/null || exit 1
CMD ["node", "server.js"]
