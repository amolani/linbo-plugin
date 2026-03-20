#!/usr/bin/env bats
# =============================================================================
# Phase 2: systemd Units + Boot Scaffold
# Tests for BASE-01, API-01, API-09
#
# Run:
#   sudo bats tests/systemd/test_systemd.bats      # Full run (requires root)
#   bats tests/systemd/test_systemd.bats            # Non-root: all tests skip
#
# These tests verify that Phase 2 systemd units, boot scaffold, and
# supporting services are correctly installed and configured.
# Tests will FAIL until Plan 03 installs the units — this is expected.
# =============================================================================

# -- BASE-01: linuxmuster-linbo7 installed --

@test "linuxmuster-linbo7 is installed" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run dpkg -l linuxmuster-linbo7
    [ "$status" -eq 0 ]
    [[ "$output" == *"ii  linuxmuster-linbo7"* ]]
}

@test "linbo7 postinst left /srv/linbo/boot/grub directory" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -d /srv/linbo/boot/grub ]
}

@test "linbo7 installed stable kernel template in /var/lib/linuxmuster/linbo/stable/linbo64" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /var/lib/linuxmuster/linbo/stable/linbo64 ]
}

@test "linbo7 installed linbofs64.xz template" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /var/lib/linuxmuster/linbo/linbofs64.xz ]
}

# -- API-09: linbo-setup.service (oneshot) --

@test "linbo-setup.service unit file is installed at /etc/systemd/system/" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /etc/systemd/system/linbo-setup.service ]
}

@test "linbo-setup.service is Type=oneshot" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "Type=oneshot" /etc/systemd/system/linbo-setup.service
    [ "$status" -eq 0 ]
}

@test "linbo-setup.service has RemainAfterExit=yes" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "RemainAfterExit=yes" /etc/systemd/system/linbo-setup.service
    [ "$status" -eq 0 ]
}

@test "linbo-setup.service ExecStart points to /usr/local/bin/setup-bootfiles.sh" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "ExecStart=/usr/local/bin/setup-bootfiles.sh" /etc/systemd/system/linbo-setup.service
    [ "$status" -eq 0 ]
}

# -- API-09: setup-bootfiles.sh ran (sentinel + files) --

@test "boot scaffold sentinel file exists" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /var/lib/linbo-native/.boot-scaffold-done ]
}

@test "/srv/linbo/linbo64 exists after scaffold" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /srv/linbo/linbo64 ]
}

@test "/srv/linbo/linbofs64 exists after scaffold" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /srv/linbo/linbofs64 ]
}

@test "/etc/rsyncd.conf contains [linbo] module" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "\[linbo\]" /etc/rsyncd.conf
    [ "$status" -eq 0 ]
}

@test "/etc/rsyncd.secrets exists with mode 600" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /etc/rsyncd.secrets ]
    run stat -c %a /etc/rsyncd.secrets
    [ "$status" -eq 0 ]
    [ "$output" = "600" ]
}

# -- API-09: tftpd-hpa and rsync enabled --

@test "tftpd-hpa.service is enabled" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run systemctl is-enabled tftpd-hpa
    [ "$status" -eq 0 ]
    # tftpd-hpa uses init.d → systemd-sysv-install wrapper which prints redirect
    # messages before "enabled". Match on content rather than exact string.
    [[ "$output" == *"enabled"* ]]
}

@test "tftpd-hpa is active and listening on UDP 69" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run ss -ulnp
    [ "$status" -eq 0 ]
    [[ "$output" == *":69 "* ]] || [[ "$output" == *":69"* ]]
}

@test "rsync.service is enabled" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run systemctl is-enabled rsync
    [ "$status" -eq 0 ]
    [[ "$output" == "enabled" ]]
}

@test "rsync.service is active" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run systemctl is-active rsync
    [ "$status" -eq 0 ]
    [[ "$output" == "active" ]]
}

# -- API-01: linbo-api.service unit directives --

@test "linbo-api.service unit file is installed at /etc/systemd/system/" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    [ -f /etc/systemd/system/linbo-api.service ]
}

@test "linbo-api.service has Requires=linbo-setup.service" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "Requires=linbo-setup.service" /etc/systemd/system/linbo-api.service
    [ "$status" -eq 0 ]
}

@test "linbo-api.service has After=linbo-setup.service" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "After=.*linbo-setup.service" /etc/systemd/system/linbo-api.service
    [ "$status" -eq 0 ]
}

@test "linbo-api.service has Restart=on-failure" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "Restart=on-failure" /etc/systemd/system/linbo-api.service
    [ "$status" -eq 0 ]
}

@test "linbo-api.service has RestartSec=5s" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "RestartSec=5s" /etc/systemd/system/linbo-api.service
    [ "$status" -eq 0 ]
}

@test "linbo-api.service has StartLimitBurst=5" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "StartLimitBurst=5" /etc/systemd/system/linbo-api.service
    [ "$status" -eq 0 ]
}

@test "linbo-api.service has StartLimitIntervalSec=120s" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "StartLimitIntervalSec=120s" /etc/systemd/system/linbo-api.service
    [ "$status" -eq 0 ]
}

@test "linbo-api.service has User=linbo" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "User=linbo" /etc/systemd/system/linbo-api.service
    [ "$status" -eq 0 ]
}

@test "linbo-api.service EnvironmentFile points to /etc/linbo-native/.env" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run grep "EnvironmentFile=/etc/linbo-native/.env" /etc/systemd/system/linbo-api.service
    [ "$status" -eq 0 ]
}

# -- API-01: linbo user exists --

@test "linbo user exists as system user" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run id linbo
    [ "$status" -eq 0 ]
}

# -- API-01: linbo-api.service enabled --

@test "linbo-api.service is enabled" {
    if [[ "$EUID" -ne 0 ]]; then skip "requires root"; fi
    run systemctl is-enabled linbo-api
    [ "$status" -eq 0 ]
    [[ "$output" == "enabled" ]]
}
