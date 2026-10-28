# Single-service image: the API serves the built dashboard (WEB_DIST_DIR).
# Host-neutral: configure everything through environment variables.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-alpine
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production \
    WEB_DIST_DIR=/app/apps/web/dist \
    PORT=3000
COPY --from=build /app /app
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
