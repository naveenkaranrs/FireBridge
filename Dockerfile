# FireBridge - NASA Space Apps Challenge 2026
# Production Docker Container
FROM node:20-alpine

WORKDIR /app

# Copy application files
COPY package.json .
COPY server.js .
COPY app.js .
COPY index.html .
COPY styles.css .
COPY data/ ./data/

# Expose standard port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start server
CMD ["node", "server.js"]

