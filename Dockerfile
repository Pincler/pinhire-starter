# Runs server.js in a small Node.js image.
#
# Build:  docker build -t pinhire-webhook .
# Run:    docker run --env-file .env -p 4300:4300 pinhire-webhook
#
# server.js uses only Node.js, so there is nothing to install.
FROM node:24-alpine

WORKDIR /app

# Copy only server.js. Your .env file stays out of the image:
# give the settings when you run the container (see "Run" above).
COPY server.js ./

# Run as the normal "node" user, not as root.
USER node

ENV PORT=4300
EXPOSE 4300

# Every 15 seconds, Docker opens /health to check that the server is up.
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "server.js"]
