#!/bin/bash
#
# Docker-compatible environment.sh for LINBO rsync hooks
#
# Drop-in replacement for /usr/share/linuxmuster/environment.sh
# Provides the same path constants as the LMN server.
#

# Core paths (match LMN server layout)
LINBODIR="/srv/linbo"
LINBOIMGDIR="${LINBODIR}/images"
LINBOGRUBDIR="${LINBODIR}/boot/grub"
LINBOLOGDIR="/var/log/linuxmuster/linbo"
LINBOSHAREDIR="/usr/share/linuxmuster/linbo"
LINBOTPLDIR="${LINBOSHAREDIR}/templates"
LINBOCACHEDIR="/var/cache/linbo"
LINBOSYSDIR="/etc/linuxmuster/linbo"
LINBOVARDIR="/var/lib/linuxmuster/linbo"
LINBOVERFILE="${LINBODIR}/linbo-version"

# Config paths
SYSDIR="/etc/linuxmuster"
SOPHOSYSDIR="${SYSDIR}/sophomorix"
DEFAULTSCHOOL="${SOPHOSYSDIR}/default-school"
WIMPORTDATA="${DEFAULTSCHOOL}/devices.csv"
SETUPINI="/var/lib/linuxmuster/setup.ini"
VARDIR="/var/lib/linuxmuster"
LOGDIR="/var/log/linuxmuster"
SHAREDIR="/usr/share/linuxmuster"
CACHEDIR="/var/cache"

# SSH helpers (linbo-scp, linbo-ssh)
# These are available in the SSH container and via the shared scripts mount
export PATH="${LINBOSHAREDIR}:${PATH}"

# Read setup.ini values if available
if [ -e "$SETUPINI" ]; then
  eval "$(grep ^'[a-z]' "$SETUPINI" | sed 's| = |="|g' | sed 's|$|"|g')"
fi

# LINBO version
LINBOVERSION=""
[ -f "$LINBOVERFILE" ] && LINBOVERSION="$(awk '{print $2}' "$LINBOVERFILE" | awk -F: '{print $1}')"

# Export commonly used variables
export LINBODIR LINBOIMGDIR LINBOGRUBDIR LINBOLOGDIR LINBOSHAREDIR
export LINBOTPLDIR LINBOCACHEDIR LINBOSYSDIR LINBOVARDIR
export WIMPORTDATA SETUPINI LINBOVERSION
