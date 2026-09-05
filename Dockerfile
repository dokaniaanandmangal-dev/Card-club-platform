FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY src ./src

USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
