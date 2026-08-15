FROM oven/bun:1.3.14 AS build

WORKDIR /app
COPY . .

RUN bun install --frozen-lockfile

ARG VITE_API_URL
ARG PUBLIC_WEBSITE_URL
ARG PUBLIC_WEBAPP_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV PUBLIC_WEBSITE_URL=${PUBLIC_WEBSITE_URL}
ENV PUBLIC_WEBAPP_URL=${PUBLIC_WEBAPP_URL}

RUN bun run build:webapp
RUN bun run build:website

FROM scratch AS export
COPY --from=build /app/webapp/dist /webapp
COPY --from=build /app/website/dist /website
