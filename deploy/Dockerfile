# تصویر اجرای PETAVU. پایگاه‌داده در این تصویر نیست؛ Postgres 18 جدا می‌آید.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY migrations ./migrations
COPY seeds ./seeds
COPY tsconfig.json tsconfig.base.json ./
RUN npm ci && npm run build && npm prune --omit=dev
USER node
EXPOSE 3000 4000
CMD ["node", "scripts/run.mjs"]
