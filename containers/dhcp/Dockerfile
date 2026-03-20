FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    isc-dhcp-server \
    inotify-tools \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
COPY reload.sh /reload.sh
COPY watch-config.sh /watch-config.sh
RUN chmod +x /entrypoint.sh /reload.sh /watch-config.sh

EXPOSE 67/udp

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD pgrep dhcpd || exit 1

ENTRYPOINT ["/entrypoint.sh"]
