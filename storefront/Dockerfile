# Nuxt storefront image.
#
# Образ ориентирован на dev-режим: устанавливает зависимости storefront-приложения
# и запускается с bind-mounted исходниками (см. docker-compose.yml).

FROM node:24.22.3-alpine3.24

RUN npm install -g pnpm@12.23.0

WORKDIR /server

# Манифесты workspace сначала — слой с зависимостями кэшируется.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY storefront/package.json ./storefront/
COPY backend/package.json ./backend/

# Устанавливаем зависимости только storefront-приложения (с dev-зависимостями:
# vue-tsc и eslint нужны для typecheck и lint).
RUN pnpm install --frozen-lockfile --filter @ecommerce-starter/storefront...

# Исходники storefront-приложения копируем до dev-скриптов,
# чтобы `nuxt dev` находил nuxt.config.ts и директорию app/.
COPY storefront/ ./storefront/

EXPOSE 3000

WORKDIR /server/storefront
