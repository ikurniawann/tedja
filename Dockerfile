FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json pnpm-lock.yaml* ./
RUN npm install --legacy-peer-deps
COPY . .
ENV NODE_ENV=production
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

EXPOSE 3000
ENV PORT=3000
USER nextjs
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -q -O- http://localhost:3000 >/dev/null || exit 1
CMD ["npm", "run", "start"]
