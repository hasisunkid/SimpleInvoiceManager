# SimpleInvoice Manager – one image with backend + built frontend (AR-10).
# Multi-arch: docker buildx build --platform linux/amd64,linux/arm64 -f docker/Dockerfile .
ARG NODE_VERSION=26

# ---------- build stage ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

# Install dependencies first (cached layer as long as manifests don't change).
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/i18n/package.json packages/i18n/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY ha-app/package.json ha-app/
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# ---------- runtime stage ----------
FROM node:${NODE_VERSION}-alpine AS runtime
# NFR-PERF-01: cap the V8 heap so the container stays well below 512 MB on a Raspberry Pi.
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8099 \
    NODE_OPTIONS=--max-old-space-size=160
WORKDIR /app

# Production node_modules; workspace packages are symlinked into packages/*.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/domain/package.json packages/domain/
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/i18n/package.json packages/i18n/
COPY --from=build /app/packages/i18n/dist packages/i18n/dist
COPY --from=build /app/apps/backend/package.json apps/backend/
COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY --from=build /app/apps/frontend/dist apps/frontend/dist

# /data holds logo and generated PDFs (AR-15).
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8099

# AR-26: the product version (Changesets-managed, = image tag) is passed in by the release
# workflow; local builds report `dev`. Declared late so a new version does not bust the cache.
ARG BUILD_VERSION=dev
ENV APP_VERSION=${BUILD_VERSION}

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

CMD ["node", "--enable-source-maps", "apps/backend/dist/server.js"]

# ---------- Home Assistant App (AR-10..16) ----------
# Same application, started by ha-app/run.sh, which maps the HA options and the MariaDB service
# credentials onto the standard environment variables (one configuration path, AR-16).
FROM runtime AS ha
ARG BUILD_VERSION=dev
ARG BUILD_ARCH=amd64
USER root
RUN apk add --no-cache jq curl
COPY ha-app/run.sh /run.sh
RUN chmod 0755 /run.sh
LABEL io.hass.type="addon" \
      io.hass.name="SimpleInvoice Manager" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      org.opencontainers.image.title="SimpleInvoice Manager" \
      org.opencontainers.image.version="${BUILD_VERSION}"
ENV DATA_DIR=/data/files
CMD ["/run.sh"]
