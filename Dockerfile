FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV TRADER_EMBEDDED=1
ENV PORT=43123
VOLUME ["/app/data"]
EXPOSE 43123
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "43123"]
