# Stage 1: Build Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Stage 2: Production App (Express serves Frontend + Backend)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --only=production

COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 4000
CMD ["node", "backend/server.js"]
