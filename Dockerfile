# syntax=docker/dockerfile:1

FROM node:20-slim AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY web/ ./
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
RUN npm install -g serve@14.2.1
COPY --from=build /app/dist ./dist
EXPOSE 4173
CMD ["serve", "-s", "dist", "-l", "4173"]
