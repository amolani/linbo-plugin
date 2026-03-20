#!/usr/bin/env bats
# =============================================================================
# INST-02 Tests — setup.sh behaviors
# Run as root after setup.sh on a live Ubuntu 24.04 host
# Non-root: all tests skip gracefully
#
# Usage:
#   sudo bats tests/install/test_setup.bats   # Full run (requires root + setup.sh executed)
#   bats tests/install/test_setup.bats         # Non-root: all tests skip
# =============================================================================

ENV_FILE="/etc/linbo-native/.env"

# --- Directory creation tests ---

@test "setup.sh creates /etc/linbo-native directory" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -d /etc/linbo-native ]
}

@test "/etc/linbo-native has mode 700" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run stat -c %a /etc/linbo-native
    [ "$status" -eq 0 ]
    [ "$output" = "700" ]
}

@test "setup.sh creates /srv/linbo-api directory" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -d /srv/linbo-api ]
}

@test "setup.sh creates /var/lib/linbo-api directory" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -d /var/lib/linbo-api ]
}

@test "setup.sh creates /var/log/linbo-native directory" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -d /var/log/linbo-native ]
}

# --- .env permission tests ---

@test "/etc/linbo-native/.env has mode 600" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run stat -c %a "$ENV_FILE"
    [ "$status" -eq 0 ]
    [ "$output" = "600" ]
}

# --- .env content: no Docker variables ---

@test ".env does not contain DOCKER_GID" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "^DOCKER_GID=" "$ENV_FILE"
    [ "$status" -ne 0 ]
}

@test ".env does not contain REDIS_HOST" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "^REDIS_HOST=" "$ENV_FILE"
    [ "$status" -ne 0 ]
}

@test ".env does not contain REDIS_URL" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "^REDIS_URL=" "$ENV_FILE"
    [ "$status" -ne 0 ]
}

@test ".env does not contain REDIS_PASSWORD" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "^REDIS_PASSWORD=" "$ENV_FILE"
    [ "$status" -ne 0 ]
}

@test ".env does not contain GITHUB_TOKEN" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "^GITHUB_TOKEN=" "$ENV_FILE"
    [ "$status" -ne 0 ]
}

# --- .env content: secrets are non-empty ---

@test "JWT_SECRET is non-empty in .env" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    local val
    val=$(grep "^JWT_SECRET=" "$ENV_FILE" | cut -d= -f2-)
    [ "${#val}" -gt 10 ]
}

@test "INTERNAL_API_KEY is non-empty in .env" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    local val
    val=$(grep "^INTERNAL_API_KEY=" "$ENV_FILE" | cut -d= -f2-)
    [ "${#val}" -gt 10 ]
}

@test "RSYNC_PASSWORD is non-empty in .env" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    local val
    val=$(grep "^RSYNC_PASSWORD=" "$ENV_FILE" | cut -d= -f2-)
    [ "${#val}" -gt 10 ]
}

# --- .env location ---

@test ".env is at /etc/linbo-native/.env not project directory" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /etc/linbo-native/.env ]
}
