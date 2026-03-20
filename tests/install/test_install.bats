#!/usr/bin/env bats
# INST-01 smoke tests — run after install.sh on a live Ubuntu 24.04 host
#
# Usage:
#   sudo bats tests/install/test_install.bats
#
# These tests verify that install.sh correctly installed all system
# dependencies. Tests requiring root or a real init system gracefully
# skip when run as a non-root user.

@test "nodejs 20 is installed" {
    run node --version
    [ "$status" -eq 0 ]
    [[ "$output" == v20.* ]]
}

@test "npm is present" {
    run npm --version
    [ "$status" -eq 0 ]
}

@test "nginx is installed" {
    run dpkg -l nginx
    [ "$status" -eq 0 ]
    [[ "$output" == *"ii  nginx"* ]]
}

@test "linuxmuster-linbo7 is installed" {
    run dpkg -l linuxmuster-linbo7
    [ "$status" -eq 0 ]
    [[ "$output" == *"ii  linuxmuster-linbo7"* ]]
}

@test "isc-dhcp-server is installed" {
    run dpkg -l isc-dhcp-server
    [ "$status" -eq 0 ]
    [[ "$output" == *"ii  isc-dhcp-server"* ]]
}

@test "isc-dhcp-server is disabled (not started with empty config)" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run systemctl is-enabled isc-dhcp-server
    [ "$status" -ne 0 ] || [[ "$output" == "disabled" ]]
}

@test "LMN APT keyring file exists" {
    [ -f /usr/share/keyrings/linuxmuster.net.gpg ]
}

@test "LMN APT sources.list.d entry uses signed-by" {
    run grep "signed-by" /etc/apt/sources.list.d/lmn73.list
    [ "$status" -eq 0 ]
}

@test "install.sh is idempotent (second run exits 0)" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    local script_dir
    script_dir="$(cd "$(dirname "${BATS_TEST_FILENAME}")/../.." && pwd)"
    run bash "${script_dir}/install.sh"
    [ "$status" -eq 0 ]
}
