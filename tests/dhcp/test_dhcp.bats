#!/usr/bin/env bats
# =============================================================================
# Phase 3: DHCP + PXE Boot
# Tests for DHCP-01, DHCP-02 (config structure), DHCP-03
#
# Run:
#   sudo bats tests/dhcp/test_dhcp.bats
#
# RED phase: all tests fail until Plan 03 runs setup-dhcp.sh and
# enables isc-dhcp-server.
# =============================================================================

# -- DHCP-01: Service state --

@test "isc-dhcp-server.service is enabled" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run systemctl is-enabled isc-dhcp-server
    [ "$status" -eq 0 ]
    [[ "$output" == "enabled" ]]
}

@test "isc-dhcp-server.service is active" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run systemctl is-active isc-dhcp-server
    [ "$status" -eq 0 ]
    [[ "$output" == "active" ]]
}

@test "INTERFACESv4 is set in /etc/default/isc-dhcp-server" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /etc/default/isc-dhcp-server ]
    run grep "^INTERFACESv4=" /etc/default/isc-dhcp-server
    [ "$status" -eq 0 ]
}

# -- DHCP-02: Config file structure (setup-dhcp.sh writes this) --

@test "/etc/dhcp/dhcpd.conf includes subnets.conf" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /etc/dhcp/dhcpd.conf ]
    run grep 'include "/etc/dhcp/subnets.conf"' /etc/dhcp/dhcpd.conf
    [ "$status" -eq 0 ]
}

@test "/etc/dhcp/dhcpd.conf includes devices.conf" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /etc/dhcp/dhcpd.conf ]
    run grep 'include "/etc/dhcp/devices.conf"' /etc/dhcp/dhcpd.conf
    [ "$status" -eq 0 ]
}

@test "/etc/dhcp/subnets.conf placeholder exists" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /etc/dhcp/subnets.conf ]
}

# -- DHCP-03: PXE boot options --

@test "dhcpd.conf contains next-server directive" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /etc/dhcp/dhcpd.conf ]
    run grep "^next-server" /etc/dhcp/dhcpd.conf
    [ "$status" -eq 0 ]
}

@test "dhcpd.conf contains UEFI x86_64 filename (arch 00:07)" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /etc/dhcp/dhcpd.conf ]
    run grep 'boot/grub/x86_64-efi/core.efi' /etc/dhcp/dhcpd.conf
    [ "$status" -eq 0 ]
}

@test "dhcpd config test passes (dhcpd -t)" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /etc/dhcp/dhcpd.conf ]
    run dhcpd -t -cf /etc/dhcp/dhcpd.conf
    [ "$status" -eq 0 ]
}
