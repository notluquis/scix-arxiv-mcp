FROM node:current-alpine AS builder

WORKDIR /build

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

# ── production image ──────────────────────────────────────────────────────────
FROM node:current-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /build/build ./build

EXPOSE 3000

CMD ["node", "build/index.js"]
