# LINBO GUI Glassmorphism Redesign

## Overview

This document describes the workflow for building, deploying, and testing
the glassmorphism redesign of the LINBO Qt6 GUI. The LINBO GUI is the
graphical interface displayed on PXE-booted client machines, providing
controls for imaging, syncing, and starting operating systems.

## Source

The modified GUI source lives at:

```
/root/linuxmuster-linbo-gui/   (v7.3.3)
```

## Build Process

The build uses a dedicated container image that contains all Qt6 and
cross-compilation dependencies.

**Build container:** `ghcr.io/linuxmuster/linuxmuster-linbo-gui-build`

**Build command:**

```bash
docker run --rm \
  -v /root/linuxmuster-linbo-gui:/src \
  ghcr.io/linuxmuster/linuxmuster-linbo-gui-build \
  bash -c "cd /src/build && rm -rf CMakeCache.txt CMakeFiles && cmake -DCMAKE_BUILD_TYPE=Release .. && make -j\$(nproc)"
```

**Output:** `/root/linuxmuster-linbo-gui/build/linbo_gui` (ELF binary, ~23 MB)

## Deploy Process

> **WARNING:** The rsync container serves files from the Docker volume at
> `/var/lib/docker/volumes/linbo_srv_data/_data`, **NOT** from `/srv/linbo/`
> on the host. Files placed in `/srv/linbo/` on the host are invisible to
> LINBO clients. All deploy steps below target the Docker volume path.

Run the following steps from the `/root/linuxmuster-linbo-gui` directory
on the build host.

### Step 1 -- Extract the original GUI archive

```bash
mkdir -p /tmp/linbo-gui-repack && cd /tmp/linbo-gui-repack
xzcat /srv/linbo/linbo_gui64_7.tar.lz | tar xf -
```

### Step 2 -- Replace the binary

```bash
cp /root/linuxmuster-linbo-gui/build/linbo_gui usr/bin/linbo_gui
chmod 755 usr/bin/linbo_gui
```

### Step 3 -- Repack the archive

```bash
tar cf - lib/ usr/ | xz -e --check=crc64 -T 0 > linbo_gui64_7.tar.lz
```

### Step 4 -- Copy into the Docker volume on the test server

```bash
scp linbo_gui64_7.tar.lz \
  root@10.0.0.13:/var/lib/docker/volumes/linbo_srv_data/_data/linbo_gui64_7.tar.lz
```

### Step 5 -- Fix ownership

```bash
ssh root@10.0.0.13 \
  "chown 1001:1001 /var/lib/docker/volumes/linbo_srv_data/_data/linbo_gui64_7.tar.lz"
```

### Step 6 -- Update the MD5 checksum

```bash
ssh root@10.0.0.13 "cd /var/lib/docker/volumes/linbo_srv_data/_data \
  && md5sum linbo_gui64_7.tar.lz | awk '{print \$1}' > linbo_gui64_7.tar.lz.md5 \
  && chown 1001:1001 linbo_gui64_7.tar.lz.md5"
```

### Step 7 -- PXE boot the test VM

Boot (or reboot) the test VM to pick up the new GUI binary.

## Rollback

The original archive is backed up with an `.orig` suffix inside the
Docker volume. To restore:

```bash
ssh root@10.0.0.13 "cd /var/lib/docker/volumes/linbo_srv_data/_data \
  && cp linbo_gui64_7.tar.lz.orig linbo_gui64_7.tar.lz \
  && md5sum linbo_gui64_7.tar.lz > linbo_gui64_7.tar.lz.md5"
```

## LOW_FX Mode

Set the environment variable `LINBO_LOW_FX=1` (also accepts `true` or
`yes`) to disable the radial mesh overlays used in the glassmorphism
design. This is useful for low-performance clients or debugging.

## Test Environment

| Property | Value |
|----------|-------|
| Test VM  | "vier" in group "amodrei" |
| Boot method | PXE with `server=10.0.0.13` |
| Test server | 10.0.0.13 (Docker host) |
| Production reference | 10.0.0.11 |
