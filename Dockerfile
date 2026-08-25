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

# python3 — better-sqlite3's native binding needs it even at runtime for
#           npm's postinstall rebuild step; also satisfies yt-dlp's own
#           interpreter requirement.
# curl, unzip — fetch the yt-dlp and Deno binaries below.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl unzip ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp powers YouTube content repurposing (src/repurpose/extract.ts) —
# downloaded as a standalone binary rather than via pip, so there's no
# Python packaging/venv to manage. Deno is required alongside it: recent
# YouTube extraction needs a JS runtime to execute player-response
# decryption, and yt-dlp silently produces incomplete results without one
# (confirmed in testing — a video with real captions returned none until
# Deno was present).
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && curl -L https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o /tmp/deno.zip \
    && unzip -q /tmp/deno.zip -d /usr/local/bin \
    && chmod a+rx /usr/local/bin/deno \
    && rm /tmp/deno.zip

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

ENV NODE_ENV=production
ENV DATABASE_PATH=/data/trendpost.db

VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "dist/server.js"]
