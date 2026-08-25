# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

# better-sqlite3 needs a C++ toolchain to compile its native binding.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV DATABASE_PATH=/data/trendpost.db

VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "dist/server.js"]
