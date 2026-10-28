FROM node:20-alpine AS runtime

WORKDIR /app

# Create non-root user for container security
RUN addgroup -S pinhire && adduser -S pinhire -G pinhire

COPY package*.json ./
RUN npm ci --omit=dev || true

COPY --chown=pinhire:pinhire . .

USER pinhire
EXPOSE 4300

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4300/healthz || exit 1

CMD ["node", "server.js"]
