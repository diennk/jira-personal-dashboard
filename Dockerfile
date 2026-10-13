FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare yarn@4.18.1 --activate

FROM base AS dependencies
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN yarn build

FROM base AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=5190

COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static

USER node
EXPOSE 5190
CMD ["node", "server.js"]
