# =============================================================================
# LINBO Docker - Web Frontend
# Multi-Stage Build: Node.js (build) + Nginx (serve)
# =============================================================================

# Stage 1: Build the React application
FROM node:20-bookworm AS builder

ARG GIT_HASH=unknown

WORKDIR /app

# Copy package files and registry config
COPY frontend/package*.json frontend/.npmrc ./

# Install dependencies (GITHUB_TOKEN needed for @edulution-io/ui-kit)
ARG GITHUB_TOKEN
RUN npm ci

# Copy source code
COPY frontend/ ./

# Build the application with git hash injected
ENV VITE_GIT_HASH=${GIT_HASH}
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:1.27-bookworm

LABEL maintainer="LINBO Docker Project"
LABEL description="Web Frontend for LINBO Docker"

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -sf http://localhost/health || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
