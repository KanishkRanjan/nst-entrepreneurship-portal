# Stage 1: Build Frontend
FROM node:22-slim AS frontend-builder
WORKDIR /app

COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

RUN rm -f package-lock.json frontend/package-lock.json backend/package-lock.json && \
    npm install --os=linux --cpu=x64 --ignore-scripts

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Stage 2: Production App (Express serves Frontend + Backend)
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

RUN npm ci --omit=dev --ignore-scripts

COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 4000
CMD ["node", "backend/server.js"]
