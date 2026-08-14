# MoneyMove needs a long-running process (WebSockets + in-memory rooms),
# so it ships as a plain container rather than serverless functions.
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
