# Feature Request: HTTP Boot Support for GRUB Templates

## Problem

LINBO's GRUB templates currently only support TFTP for netboot. This limits deployment flexibility:

- **Docker/Container deployments** cannot use TFTP easily (UDP port 69 requires host networking or complex proxying)
- **Multi-server setups** where the LINBO server IP differs from the PXE/DHCP server
- **Performance**: HTTP is significantly faster than TFTP for large file transfers (linbo64 ~15MB, linbofs64 ~80MB)
- **Firewall-friendliness**: HTTP uses a single TCP port vs. TFTP's UDP with ephemeral ports

## Evidence: Already Considered

In `grub.cfg.forced_netboot`, line 40:

```grub
 set root="(tftp)"
 # perhaps faster
 #set root="(http)"
```

This comment shows HTTP boot was already considered but never implemented.

## Proposed Solution

Add optional HTTP boot support to GRUB templates, controlled by a new `@@serverip@@` placeholder. When `server=<IP>` is passed on the kernel command line, LINBO connects to that server. The same mechanism enables HTTP boot in GRUB.

### Design Principle

- **Backward compatible**: Without configuration changes, behavior is identical (TFTP)
- **Opt-in**: HTTP boot is only used when explicitly configured via start.conf or server settings
- **Minimal changes**: Only the netboot fallback paths need modification

---

## Changes Required

### 1. New Placeholders

| Placeholder | Purpose | Default |
|-------------|---------|---------|
| `@@httpboot@@` | Enable HTTP boot (`true`/empty) | *(empty = TFTP)* |
| `@@serverip@@` | Server IP for HTTP root | *(from server config)* |
| `@@httpport@@` | HTTP port (TFTP container serves HTTP too) | `80` |

### 2. Template Changes

#### `grub.cfg.global` (Line 63-66)

**Current:**
```grub
 elif [ -n "$pxe_default_server" ]; then
  set root="(tftp)"
  set bootflag=netboot
 fi
```

**Proposed:**
```grub
 elif [ -n "$pxe_default_server" ]; then
  if [ "@@httpboot@@" = "true" ]; then
   insmod http
   set root="(http,@@serverip@@:@@httpport@@)"
  else
   set root="(tftp)"
  fi
  set bootflag=netboot
 fi
```

#### `grub.cfg.os` (3 identical blocks: Linbo-Start, Sync+Start, Neu+Start)

**Current** (lines 63-66, 86-89, 109-112):
```grub
 elif [ -n "$pxe_default_server" ]; then
  set root="(tftp)"
  set bootflag=netboot
 fi
```

**Proposed** (same change in all 3 menuentries):
```grub
 elif [ -n "$pxe_default_server" ]; then
  if [ "@@httpboot@@" = "true" ]; then
   insmod http
   set root="(http,@@serverip@@:@@httpport@@)"
  else
   set root="(tftp)"
  fi
  set bootflag=netboot
 fi
```

#### `grub.cfg.pxe` (Lines 148-160, failsafe netboot)

**Current:**
```grub
 # finally try netboot linbo directly in failsafe mode
 set root="${netroot}"
```

Where `netroot` is set at line 10:
```grub
set netroot="(tftp)"
```

**Proposed:**
```grub
if [ "@@httpboot@@" = "true" ]; then
 insmod http
 set netroot="(http,@@serverip@@:@@httpport@@)"
else
 set netroot="(tftp)"
fi
```

#### `grub.cfg.forced_netboot` (Line 38)

**Current:**
```grub
 set root="(tftp)"
 # perhaps faster
 #set root="(http)"
```

**Proposed:**
```grub
 if [ "@@httpboot@@" = "true" ]; then
  insmod http
  set root="(http,@@serverip@@:@@httpport@@)"
 else
  set root="(tftp)"
 fi
```

### 3. Generator Change: `linuxmuster-import-devices`

In `doGrubCfg()` (line 122), add new placeholders to `replace_list`:

```python
# Current
replace_list = [('@@group@@', group), ('@@cachelabel@@', cachelabel),
                ('@@cacheroot@@', cacheroot), ('@@kopts@@', kopts)]

# Proposed
httpboot = setup.get('HTTPBOOT', '')  # from server config or empty
serverip = setup.get('SERVERIP', '')  # from setup.ini or server IP
httpport = setup.get('HTTPPORT', '80')
replace_list = [('@@group@@', group), ('@@cachelabel@@', cachelabel),
                ('@@cacheroot@@', cacheroot), ('@@kopts@@', kopts),
                ('@@httpboot@@', httpboot), ('@@serverip@@', serverip),
                ('@@httpport@@', httpport)]
```

The same placeholders need to be added to the OS template replacement (line 154-160).

**Note:** The exact source of these values (setup.ini, environment variable, or start.conf option) is up to the maintainer. A simple approach would be a new option in `/etc/linuxmuster/linbo/start.conf`:

```ini
[LINBO]
Server = 10.0.0.1
HttpBoot = true
HttpPort = 80
```

---

## Alternative: Simpler Approach

If a new start.conf option is too invasive, a simpler alternative:

Instead of 3 placeholders, use a single `@@netroot@@` placeholder:

```python
# In doGrubCfg():
if httpboot_enabled:
    netroot = f'(http,{serverip}:{httpport})'
else:
    netroot = '(tftp)'
```

Then templates just use:
```grub
set root="@@netroot@@"
```

This is cleaner but loses the `insmod http` call — which may already be loaded by the GRUB build.

---

## Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| No config change | `@@httpboot@@` stays empty, all `if` blocks evaluate false → TFTP (unchanged) |
| `HttpBoot = true` | HTTP boot enabled, server IP from config |
| Mixed environment | Per-group configuration possible via start.conf |

## Testing

1. **TFTP (unchanged):** Boot without HttpBoot setting → must work exactly as before
2. **HTTP boot:** Set HttpBoot=true, verify GRUB loads linbo64+linbofs64 via HTTP
3. **Failsafe:** Test grub.cfg.pxe failsafe path with HTTP
4. **Forced netboot:** Test grub.cfg.forced_netboot with HTTP

## Real-World Validation

This HTTP boot approach has been tested and is running in production with:
- Intel Core Ultra 5 (NVMe, Intel NIC) — EFI boot
- Various Lenovo models — EFI boot
- GRUB loading ~95MB (linbo64 + linbofs64) over HTTP successfully
- No TFTP-related timeout issues that occasionally occur with large files

## References

- GRUB HTTP boot: https://www.gnu.org/software/grub/manual/grub/html_node/Network.html
- linuxmuster-linbo7: https://github.com/linuxmuster/linuxmuster-linbo7
