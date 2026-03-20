# =============================================================================
# LINBO Docker - SSH Server
# Provides remote command execution to LINBO clients
# =============================================================================
# Pinned 2026-03-06 — update periodically
FROM ubuntu:24.04

LABEL maintainer="LINBO Docker Project"
LABEL description="SSH Server for LINBO Remote Commands"

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install required packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    openssh-client \
    dropbear-bin \
    tmux \
    rsync \
    qemu-utils \
    wakeonlan \
    python3 \
    curl \
    jq \
    iproute2 \
    iputils-ping \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Create required directories
RUN mkdir -p /var/run/sshd \
    /var/log/linuxmuster/linbo \
    /srv/linbo \
    /etc/linuxmuster/linbo \
    /usr/share/linuxmuster/linbo \
    /usr/share/linuxmuster

# Configure SSH daemon
RUN echo 'Port 2222' >> /etc/ssh/sshd_config && \
    echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config && \
    echo 'PubkeyAuthentication yes' >> /etc/ssh/sshd_config && \
    echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config

# Copy helper functions (replacing linuxmuster helperfunctions.sh)
COPY helperfunctions.sh /usr/share/linuxmuster/helperfunctions.sh
RUN chmod +x /usr/share/linuxmuster/helperfunctions.sh

# Copy startup script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# SSH uses TCP port 2222
EXPOSE 2222

# Start SSH daemon
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/sbin/sshd", "-D", "-e"]
