# =============================================================================
# LINBO Docker - API Backend
# Node.js REST API with WebSocket support (sync-only, Redis-backed)
# =============================================================================

FROM node:20-bookworm-slim

LABEL maintainer="LINBO Docker Project"
LABEL description="REST API Backend for LINBO (sync-only mode, Redis-backed)"
LABEL version="1.0.0"

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    argon2 \
    cpio \
    curl \
    dpkg \
    dropbear-bin \
    fakeroot \
    findutils \
    innoextract \
    kmod \
    locales \
    openssh-client \
    openssl \
    p7zip-full \
    rsync \
    tar \
    tini \
    tzdata \
    xz-utils \
    zstd \
    && rm -rf /var/lib/apt/lists/*

# Generate locale (needed for linbofs64 build — matches reference LMN server)
RUN sed -i '/de_DE.UTF-8/s/^# //' /etc/locale.gen && locale-gen de_DE.UTF-8
ENV LANG=de_DE.UTF-8

# Create non-root user for security
RUN groupadd -g 1001 linbo && \
    useradd -u 1001 -g linbo -s /bin/bash linbo

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy application code
COPY src ./src/

# Create required directories with correct permissions
RUN mkdir -p /srv/linbo /srv/linbo/dhcp/devices /var/log/linuxmuster/linbo /etc/linuxmuster/linbo /var/lib/linuxmuster/linbo /var/cache/linbo /var/lib/linbo/drivers && \
    chown -R linbo:linbo /app /srv/linbo /var/log/linuxmuster/linbo /etc/linuxmuster/linbo /var/lib/linuxmuster/linbo /var/cache/linbo /var/lib/linbo/drivers

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Use tini as init system for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--"]

# Switch to non-root user
USER linbo

# Start the application
CMD ["node", "src/index.js"]
