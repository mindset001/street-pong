FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p data && chown -R node:node /app
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["node", "src/index.js"]
