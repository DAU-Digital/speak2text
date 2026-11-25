FROM node:24-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY web web
COPY server server
RUN cd web && npm run build && cd ../server && npm run build

FROM node:24-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
