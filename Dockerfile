# Pin reviewed image digests in the actual deployment pipeline before production.
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG APP_SCOPE=web
RUN case "$APP_SCOPE" in public|web|panel|adminpanel|shop|adminshop) ;; *) exit 1 ;; esac && npm run "build:$APP_SCOPE" && mkdir /artifact && cp -r "dist/$APP_SCOPE/." /artifact/
FROM node:24-alpine AS runtime
ARG APP_SCOPE=web
ENV NODE_ENV=production APP_SCOPE=${APP_SCOPE} PETAVU_MODE=unconfigured PORT=8080 STATIC_DIR=/app/static
WORKDIR /app
COPY --from=builder /artifact /app/static
COPY scripts/serve.mjs scripts/serve-public.mjs scripts/run.mjs /app/
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","run.mjs"]
