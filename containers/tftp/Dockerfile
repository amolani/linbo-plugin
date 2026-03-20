# =============================================================================
# LINBO Docker - TFTP Server
# Provides PXE boot files (kernel, initramfs, GRUB)
# =============================================================================
# Pinned 2026-03-06 — update periodically
FROM ubuntu:24.04

LABEL maintainer="LINBO Docker Project"
LABEL description="TFTP Server for LINBO PXE Boot"

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install TFTP server
RUN apt-get update && apt-get install -y --no-install-recommends \
    tftpd-hpa \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /srv/linbo

# Configure TFTP
COPY tftpd-hpa.conf /etc/default/tftpd-hpa

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# TFTP uses UDP port 69
EXPOSE 69/udp

# Wait for built linbofs64 before starting TFTP
ENTRYPOINT ["/entrypoint.sh"]
CMD ["in.tftpd", "-L", "-u", "tftp", "-a", "0.0.0.0:69", "-s", "/srv/linbo", "--blocksize", "1468", "--verbosity", "3"]
