#!/bin/bash
# =============================================================================
# LINBO Docker - SSH Container Entrypoint
# =============================================================================

set -e

# Create required directories
mkdir -p /var/run/sshd
mkdir -p /var/log/linuxmuster/linbo
mkdir -p /root/.ssh

# Generate SSH host keys if they don't exist
if [ ! -f /etc/linuxmuster/linbo/ssh_host_rsa_key ]; then
    echo "Generating SSH host keys..."
    ssh-keygen -t rsa -b 4096 -f /etc/linuxmuster/linbo/ssh_host_rsa_key -N ""
    ssh-keygen -t ed25519 -f /etc/linuxmuster/linbo/ssh_host_ed25519_key -N ""
fi

# --- Dropbear host keys (for LINBO client SSH daemon inside linbofs64) ---
if [ ! -f /etc/linuxmuster/linbo/dropbear_rsa_host_key ]; then
    echo "Generating Dropbear RSA host key..."
    dropbearkey -t rsa -f /etc/linuxmuster/linbo/dropbear_rsa_host_key
fi
if [ ! -f /etc/linuxmuster/linbo/dropbear_dss_host_key ]; then
    echo "Generating Dropbear DSS host key..."
    dropbearkey -t dss -f /etc/linuxmuster/linbo/dropbear_dss_host_key
fi

# --- LINBO client key (API → Client SSH connections) ---
if [ ! -f /etc/linuxmuster/linbo/linbo_client_key ]; then
    if [ -f /root/.ssh/id_rsa ] && [ -s /root/.ssh/id_rsa ]; then
        cp /root/.ssh/id_rsa /etc/linuxmuster/linbo/linbo_client_key
        ssh-keygen -y -f /root/.ssh/id_rsa > /etc/linuxmuster/linbo/linbo_client_key.pub
        echo "  Copied host id_rsa as linbo_client_key"
    else
        ssh-keygen -t rsa -b 4096 -f /etc/linuxmuster/linbo/linbo_client_key -N "" -q
        echo "  Generated new linbo_client_key"
    fi

    # Signal API to rebuild linbofs64 with new authorized_keys
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ssh-keygen" > /srv/linbo/.needs-rebuild
    chmod 664 /srv/linbo/.needs-rebuild
    chown 1001:1001 /srv/linbo/.needs-rebuild
    echo "  Set .needs-rebuild marker for linbofs64 auto-rebuild"
fi

# Ensure .pub exists
if [ ! -f /etc/linuxmuster/linbo/linbo_client_key.pub ]; then
    ssh-keygen -y -f /etc/linuxmuster/linbo/linbo_client_key \
      > /etc/linuxmuster/linbo/linbo_client_key.pub 2>/dev/null
fi

# server_id_rsa.pub (compatibility with update-linbofs.sh)
if [ ! -f /etc/linuxmuster/linbo/server_id_rsa.pub ]; then
    cp /etc/linuxmuster/linbo/linbo_client_key.pub \
       /etc/linuxmuster/linbo/server_id_rsa.pub
fi

# Fix key ownership and permissions so API container (uid 1001) can read them
# Keys need 644 because update-linbofs.sh runs under fakeroot (different effective UID)
chown 1001:1001 /etc/linuxmuster/linbo/*_key /etc/linuxmuster/linbo/*_key.pub /etc/linuxmuster/linbo/dropbear_* /etc/linuxmuster/linbo/server_id_rsa* 2>/dev/null || true
chmod 644 /etc/linuxmuster/linbo/dropbear_* /etc/linuxmuster/linbo/linbo_client_key /etc/linuxmuster/linbo/linbo_client_key.pub /etc/linuxmuster/linbo/server_id_rsa.pub 2>/dev/null || true

# Link SSH host keys to sshd config location
ln -sf /etc/linuxmuster/linbo/ssh_host_rsa_key /etc/ssh/ssh_host_rsa_key
ln -sf /etc/linuxmuster/linbo/ssh_host_rsa_key.pub /etc/ssh/ssh_host_rsa_key.pub

if [ -f /etc/linuxmuster/linbo/ssh_host_ed25519_key ]; then
    ln -sf /etc/linuxmuster/linbo/ssh_host_ed25519_key /etc/ssh/ssh_host_ed25519_key
    ln -sf /etc/linuxmuster/linbo/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ed25519_key.pub
fi

# Set correct permissions
chmod 600 /etc/ssh/ssh_host_*_key 2>/dev/null || true
chmod 644 /etc/ssh/ssh_host_*_key.pub 2>/dev/null || true

# Copy SSH config if exists
if [ -f /etc/linuxmuster/linbo/ssh_config ]; then
    cp /etc/linuxmuster/linbo/ssh_config /root/.ssh/config
    chmod 600 /root/.ssh/config
fi

# Make scripts executable
chmod +x /usr/share/linuxmuster/linbo/*.sh 2>/dev/null || true
chmod +x /usr/share/linuxmuster/helperfunctions.sh 2>/dev/null || true

# Link linbo-remote to sbin if exists
if [ -f /usr/share/linuxmuster/linbo/linbo-remote ]; then
    ln -sf /usr/share/linuxmuster/linbo/linbo-remote /usr/sbin/linbo-remote
    chmod +x /usr/sbin/linbo-remote
fi

# Create symlinks for linbo-ssh and linbo-scp
if [ -f /usr/share/linuxmuster/linbo/linbo-ssh.sh ]; then
    ln -sf /usr/share/linuxmuster/linbo/linbo-ssh.sh /usr/sbin/linbo-ssh
fi
if [ -f /usr/share/linuxmuster/linbo/linbo-scp.sh ]; then
    ln -sf /usr/share/linuxmuster/linbo/linbo-scp.sh /usr/sbin/linbo-scp
fi

echo "LINBO SSH Server starting..."
echo "Server IP: ${LINBO_SERVER_IP:-not set}"

# Execute the main command
exec "$@"
