FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY backend/package.json backend/package.json
COPY webapp/package.json webapp/package.json
COPY website/package.json website/package.json
COPY mobile/package.json mobile/package.json

RUN bun install --frozen-lockfile

COPY packages/contracts packages/contracts
COPY backend backend

WORKDIR /app/backend

RUN DATABASE_URL="postgresql://superuser:superpassword@localhost:5432/web_app_demo?schema=public" bun run prisma:generate

ENV NODE_ENV=production

CMD ["bun", "run", "start"]
