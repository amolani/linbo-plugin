# =============================================================================
# LINBO Docker - RSYNC Server
# Provides image synchronization for LINBO clients
# =============================================================================
# Pinned 2026-03-06 — update periodically
FROM ubuntu:24.04

LABEL maintainer="LINBO Docker Project"
LABEL description="RSYNC Server for LINBO Image Sync"

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install rsync + curl (needed for API hook scripts)
RUN apt-get update && apt-get install -y --no-install-recommends \
    rsync \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /srv/linbo /var/log /usr/share/linuxmuster/linbo /var/lib/linbo/drivers

# Create rsync log directory
RUN mkdir -p /var/log && touch /var/log/rsyncd.log /var/log/rsync-hooks.log

# Copy API hook scripts
COPY scripts/ /usr/share/linuxmuster/linbo/
RUN chmod +x /usr/share/linuxmuster/linbo/*.sh

# RSYNC uses TCP port 873
EXPOSE 873

# Run rsync daemon in foreground
CMD ["rsync", "--daemon", "--no-detach", "--config=/etc/rsyncd.conf", "-v"]
