# Medusa backend image.
#
# Образ ориентирован на dev-режим: устанавливает зависимости backend-приложения
# и запускается с bind-mounted исходниками (см. docker-compose.yml).
#
# ВАЖНО: рабочая директория /server, а не /app — путь /app зарезервирован
# Medusa Admin (см. официальную документацию Medusa по Docker).

FROM node:24.22.3-alpine3.24

RUN npm install -g pnpm@12.23.0

WORKDIR /server

# Сначала копируем только манифесты workspace — чтобы слой с зависимостями
# кэшировался и не пересобирался при изменении исходников.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY backend/package.json ./backend/
COPY storefront/package.json ./storefront/

# Устанавливаем зависимости только backend-приложения (с dev-зависимостями:
# eslint/typescript нужны для medusa develop и tsc).
RUN pnpm install --frozen-lockfile --filter @ecommerce-starter/backend...

# Копируем исходники backend-приложения.
COPY backend/ ./backend/

EXPOSE 9000 5173

WORKDIR /server/backend
