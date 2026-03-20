#!/bin/bash
set -e
set -o pipefail

# Configuration
DEB_BASE_URL="${DEB_BASE_URL:-https://deb.linuxmuster.net}"
DEB_DIST="${DEB_DIST:-lmn73}"
PACKAGES_URL="${DEB_BASE_URL}/dists/${DEB_DIST}/main/binary-amd64/Packages"
LINBO_DIR="/srv/linbo"
KERNEL_DIR="/var/lib/linuxmuster/linbo"
VERSION_FILE="${LINBO_DIR}/linbo-version"
FORCE_UPDATE="${FORCE_UPDATE:-false}"

CACHE_DIR="${LINBO_DIR}/.cache"
CHECKPOINT_DIR="${LINBO_DIR}/.checkpoints"

LINBO_PKG="${LINBO_PKG:-linuxmuster-linbo7}"
GUI_PKG="${GUI_PKG:-linuxmuster-linbo-gui7}"
LOCAL_GUI_DEB="/opt/edulution-linbo-gui7.deb"

START_TIME=$(date +%s)

# =============================================================================
# Section 1: Error Reporting Functions
# =============================================================================

# Print structured error block to stderr
# Usage: error_block <title> <details> <cause> <diagnostics> <fix>
# diagnostics may be empty string to skip that section
error_block() {
    _title="$1"
    _details="$2"
    _cause="$3"
    _diagnostics="$4"
    _fix="$5"

    echo "" >&2
    echo "=== ERROR: ${_title} ===" >&2
    echo "${_details}" >&2
    echo "Cause:   ${_cause}" >&2
    if [ -n "${_diagnostics}" ]; then
        echo "" >&2
        echo "Diagnostics:" >&2
        echo "${_diagnostics}" >&2
    fi
    echo "" >&2
    echo "Fix: ${_fix}" >&2
    echo "" >&2
    echo "To retry:  docker compose up init" >&2
    echo "To reset:  FORCE_UPDATE=true docker compose up init" >&2
    echo "===========================================" >&2
    echo "" >&2
}

# Map curl exit codes to human-readable cause strings
# Usage: classify_curl_error <exit_code>
classify_curl_error() {
    _exit_code="$1"
    case "${_exit_code}" in
        5)  echo "Could not resolve proxy" ;;
        6)  echo "DNS resolution failed" ;;
        7)  echo "Connection refused" ;;
        22) echo "HTTP error (404 or server error)" ;;
        28) echo "Connection timeout" ;;
        35) echo "TLS/SSL handshake failed" ;;
        47) echo "Too many redirects" ;;
        52) echo "Server returned empty response" ;;
        56) echo "Network data transfer failed" ;;
        *)  echo "Download failed (curl exit code: ${_exit_code})" ;;
    esac
}

# Run network diagnostics for a given hostname
# Usage: run_network_diagnostics <hostname>
# Echoes multi-line diagnostics string (each line prefixed with "  ")
run_network_diagnostics() {
    _host="$1"

    if getent hosts "${_host}" >/dev/null 2>&1; then
        echo "  DNS:   OK - ${_host} resolves"
    else
        echo "  DNS:   FAIL - cannot resolve ${_host}"
    fi
    if [ -n "${HTTP_PROXY:-}" ] || [ -n "${HTTPS_PROXY:-}" ]; then
        echo "  Proxy: HTTP_PROXY=${HTTP_PROXY:-unset}, HTTPS_PROXY=${HTTPS_PROXY:-unset}"
    else
        echo "  Proxy: not set (HTTP_PROXY/HTTPS_PROXY)"
    fi
}

# =============================================================================
# Section 2: Pre-flight Check Functions
# =============================================================================

# Check available disk space on LINBO_DIR (requires >= 500MB)
check_disk_space() {
    _avail_kb=$(df -P "${LINBO_DIR}" | awk 'NR==2 {print $4}')
    _avail_mb=$((_avail_kb / 1024))
    _min_mb=500

    if [ "${_avail_mb}" -lt "${_min_mb}" ]; then
        error_block \
            "Insufficient disk space" \
            "Path:      ${LINBO_DIR}
Available: ${_avail_mb}MB
Required:  ${_min_mb}MB" \
            "Not enough free space to download and extract LINBO packages" \
            "" \
            "Free up space on the volume mounted at ${LINBO_DIR}"
        return 1
    fi
    echo "  Disk space: ${_avail_mb}MB available (>= ${_min_mb}MB required)"
}

# Check DNS resolution for deb.linuxmuster.net
check_dns() {
    _host="deb.linuxmuster.net"
    if ! getent hosts "${_host}" >/dev/null 2>&1; then
        _diag=$(run_network_diagnostics "${_host}")
        error_block \
            "DNS resolution failed" \
            "Host: ${_host}" \
            "Cannot resolve the APT repository hostname" \
            "${_diag}" \
            "Check /etc/resolv.conf or configure HTTP_PROXY/HTTPS_PROXY"
        return 1
    fi
    echo "  DNS: ${_host} resolves OK"
}

# Check write permission on a path
# Usage: check_write_permission <path>
check_write_permission() {
    _path="$1"
    if [ -d "${_path}" ] && ! touch "${_path}/.write-test" 2>/dev/null; then
        _current_owner=$(stat -c '%u:%g' "${_path}" 2>/dev/null || echo "unknown")
        error_block \
            "Permission denied (EACCES)" \
            "Path:     ${_path}
Owner:    ${_current_owner}
Expected: 1001:1001" \
            "Cannot write to the volume directory" \
            "" \
            "Run: docker run --rm -v linbo_srv_data:${_path} alpine chown -R 1001:1001 ${_path}"
        return 1
    fi
    rm -f "${_path}/.write-test" 2>/dev/null
}

# =============================================================================
# Section 3: Checkpoint Functions
# =============================================================================

# Check if a checkpoint marker exists
# Usage: checkpoint_exists <step_name>
checkpoint_exists() {
    _step="$1"
    [ -f "${CHECKPOINT_DIR}/${_step}" ]
}

# Set a checkpoint marker with version and timestamp (atomic write)
# Usage: checkpoint_set <step_name> <version>
checkpoint_set() {
    _step="$1"
    _version="$2"
    mkdir -p "${CHECKPOINT_DIR}"
    _marker="${CHECKPOINT_DIR}/${_step}"
    _marker_tmp="${_marker}.tmp"
    echo "version=${_version}" > "${_marker_tmp}"
    echo "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${_marker_tmp}"
    mv "${_marker_tmp}" "${_marker}"
}

# Clear all checkpoint markers and cached downloads
checkpoint_clear_all() {
    rm -rf "${CHECKPOINT_DIR}"
    rm -rf "${CACHE_DIR}"
}

# Check if checkpoint exists AND its version matches expected
# Usage: checkpoint_version_match <step_name> <expected_version>
checkpoint_version_match() {
    _step="$1"
    _expected="$2"
    _marker="${CHECKPOINT_DIR}/${_step}"
    if [ ! -f "${_marker}" ]; then
        return 1
    fi
    _stored_version=$(grep '^version=' "${_marker}" | cut -d= -f2-)
    [ "${_stored_version}" = "${_expected}" ]
}

# Check if any checkpoint marker files exist (for resume banner detection)
has_any_checkpoint() {
    if [ -d "${CHECKPOINT_DIR}" ] && [ "$(ls -A "${CHECKPOINT_DIR}" 2>/dev/null)" ]; then
        return 0
    fi
    return 1
}

# =============================================================================
# Section 4: Enhanced Download and Verify Functions
# =============================================================================

# Verify SHA256 with structured error block on mismatch
# Usage: verify_sha256_structured <file> <expected_hash> <label>
verify_sha256_structured() {
    _file="$1"
    _expected="$2"
    _label="$3"

    if [ -z "${_expected}" ]; then
        echo "  WARNING: No SHA256 to verify for ${_file}"
        return 0
    fi

    _actual=$(sha256sum "${_file}" | cut -d' ' -f1)
    if [ "${_actual}" != "${_expected}" ]; then
        error_block \
            "SHA256 verification failed" \
            "Package:  ${_label}
File:     $(basename "${_file}")
Expected: ${_expected}
Actual:   ${_actual}" \
            "Downloaded file does not match expected checksum" \
            "" \
            "Retry the download, or check if the APT mirror is up to date"
        return 1
    fi
    echo "  SHA256 OK: $(basename "${_file}")"
}

# Download a URL with retry logic and structured error on exhaustion
# Usage: download_with_retry <url> <output_path>
download_with_retry() {
    _url="$1"
    _output="$2"
    _max_retries=3
    _retry=0

    while [ ${_retry} -lt ${_max_retries} ]; do
        _curl_exit=0
        curl -fSL --progress-bar -o "${_output}" "${_url}" || _curl_exit=$?

        if [ ${_curl_exit} -eq 0 ]; then
            return 0
        fi

        _retry=$((_retry + 1))
        if [ ${_retry} -lt ${_max_retries} ]; then
            echo "  Download attempt ${_retry}/${_max_retries} failed, retrying in 5s..."
            sleep 5
        fi
    done

    # All retries exhausted -- build diagnostics
    _cause=$(classify_curl_error "${_curl_exit}")
    _dl_host=$(echo "${_url}" | sed 's|https\{0,1\}://||;s|/.*||')
    _diag=$(run_network_diagnostics "${_dl_host}")

    error_block \
        "Download failed" \
        "URL:      ${_url}
Attempts: ${_max_retries}" \
        "${_cause}" \
        "${_diag}" \
        "Check network connectivity, DNS, or configure HTTP_PROXY"
    return 1
}

# Download a .deb to cache dir, verify SHA256, set checkpoint
# Usage: download_and_cache_deb <filename> <sha256> <label> <cache_subdir>
# Does NOT extract -- extraction happens separately
download_and_cache_deb() {
    _filename="$1"
    _sha256="$2"
    _label="$3"
    _cache_subdir="$4"

    _cache_path="${CACHE_DIR}/${_cache_subdir}"
    mkdir -p "${_cache_path}"

    _url="${DEB_BASE_URL}/${_filename}"
    _deb_file="${_cache_path}/$(basename "${_filename}")"

    # Check if cached file exists with matching SHA256
    if [ -f "${_deb_file}" ]; then
        _cached_hash=$(sha256sum "${_deb_file}" | cut -d' ' -f1)
        if [ "${_cached_hash}" = "${_sha256}" ]; then
            echo "  Cached: $(basename "${_deb_file}") (SHA256 OK, skipping download)"
            return 0
        fi
        echo "  Cached file SHA256 mismatch, re-downloading..."
        rm -f "${_deb_file}"
    fi

    echo "  Downloading ${_url}..."
    if ! download_with_retry "${_url}" "${_deb_file}"; then
        return 1
    fi

    verify_sha256_structured "${_deb_file}" "${_sha256}" "${_label}" || return 1

    # Set checkpoint after successful download+verify
    checkpoint_set "${_label}" "${_sha256}"
}

# =============================================================================
# Section 5: Success Summary
# =============================================================================

# Print final success summary
# Usage: print_success_summary <version> <duration_seconds>
print_success_summary() {
    _version="$1"
    _duration="$2"

    # Collect kernel versions
    _kernel_info=""
    for _v in stable longterm legacy; do
        _vfile="${LINBO_DIR}/kernels/${_v}/version"
        if [ -f "${_vfile}" ]; then
            _kver=$(cat "${_vfile}")
            if [ -n "${_kernel_info}" ]; then
                _kernel_info="${_kernel_info}, ${_v} (${_kver})"
            else
                _kernel_info="${_v} (${_kver})"
            fi
        fi
    done

    # GUI status
    if [ -f "${LINBO_DIR}/linbo_gui64_7.tar.lz" ]; then
        _gui="linbo_gui64_7.tar.lz installed"
    else
        _gui="not installed"
    fi

    # Themes
    _themes=""
    if [ -d "${LINBO_DIR}/gui-themes" ]; then
        for _td in "${LINBO_DIR}/gui-themes"/*/; do
            [ -d "${_td}" ] || continue
            _tn=$(basename "${_td}")
            if [ -n "${_themes}" ]; then
                _themes="${_themes}, ${_tn}"
            else
                _themes="${_tn}"
            fi
        done
    fi
    if [ -z "${_themes}" ]; then
        _themes="none"
    fi

    echo ""
    echo "=== LINBO Init Complete ==="
    echo "Version:  ${_version}"
    echo "Kernels:  ${_kernel_info:-none}"
    echo "GUI:      ${_gui}"
    echo "Themes:   ${_themes}"
    echo "Duration: ${_duration}s"
    echo "==========================="
}

# =============================================================================
# APT Package Helpers
# =============================================================================

fetch_packages_index() {
    echo "Fetching APT Packages index..."
    PACKAGES_CACHE=$(mktemp)

    # Try gzipped first, fallback to plain
    if curl -fsSL -o "${PACKAGES_CACHE}.gz" "${PACKAGES_URL}.gz" 2>/dev/null; then
        gunzip -f "${PACKAGES_CACHE}.gz"
    elif curl -fsSL -o "${PACKAGES_CACHE}" "${PACKAGES_URL}" 2>/dev/null; then
        true
    else
        _curl_exit=$?
        _cause=$(classify_curl_error "${_curl_exit}")
        _dl_host=$(echo "${PACKAGES_URL}" | sed 's|https\{0,1\}://||;s|/.*||')
        _diag=$(run_network_diagnostics "${_dl_host}")
        error_block \
            "APT index fetch failed" \
            "URL: ${PACKAGES_URL}" \
            "${_cause}" \
            "${_diag}" \
            "Check network connectivity, DNS, or configure HTTP_PROXY"
        rm -f "${PACKAGES_CACHE}" "${PACKAGES_CACHE}.gz"
        return 1
    fi

    echo "  Packages index fetched"
}

# Parse package info from Packages index
# Usage: parse_package_info <package_name>
# Sets: PKG_VERSION, PKG_FILENAME, PKG_SHA256, PKG_SIZE
parse_package_info() {
    _pkg_name="$1"
    PKG_VERSION=""
    PKG_FILENAME=""
    PKG_SHA256=""
    PKG_SIZE=""

    # Use awk to extract the stanza for the package
    _stanza=$(awk -v pkg="${_pkg_name}" '
        /^$/ { if (found) exit; inpkg=0; next }
        /^Package:/ { if ($2 == pkg) { found=1; inpkg=1 } else { inpkg=0 } }
        inpkg { print }
    ' "${PACKAGES_CACHE}")

    if [ -z "${_stanza}" ]; then
        echo "  WARNING: Package ${_pkg_name} not found in index"
        return 1
    fi

    PKG_VERSION=$(echo "${_stanza}" | awk '/^Version:/ { print $2 }')
    PKG_FILENAME=$(echo "${_stanza}" | awk '/^Filename:/ { print $2 }')
    PKG_SHA256=$(echo "${_stanza}" | awk '/^SHA256:/ { print $2 }')
    PKG_SIZE=$(echo "${_stanza}" | awk '/^Size:/ { print $2 }')

    echo "  ${_pkg_name}: version=${PKG_VERSION}, size=${PKG_SIZE}"
}

verify_sha256() {
    _file="$1"
    _expected="$2"

    if [ -z "${_expected}" ]; then
        echo "  WARNING: No SHA256 to verify for ${_file}"
        return 0
    fi

    _actual=$(sha256sum "${_file}" | cut -d' ' -f1)
    if [ "${_actual}" != "${_expected}" ]; then
        echo "ERROR: SHA256 mismatch for ${_file}"
        echo "  Expected: ${_expected}"
        echo "  Actual:   ${_actual}"
        return 1
    fi
    echo "  SHA256 OK: $(basename "${_file}")"
}

# Download .deb with retry, verify SHA256, extract with dpkg-deb
# Usage: download_and_extract_deb <filename> <sha256> <extract_dir>
download_and_extract_deb() {
    _filename="$1"
    _sha256="$2"
    _extract_dir="$3"

    _url="${DEB_BASE_URL}/${_filename}"
    _deb_file="${TEMP_DIR}/$(basename "${_filename}")"

    echo "  Downloading ${_url}..."
    _retry=0
    _max_retries=3
    while [ ${_retry} -lt ${_max_retries} ]; do
        if curl -fSL --progress-bar -o "${_deb_file}" "${_url}"; then
            break
        fi
        _retry=$((_retry + 1))
        echo "  Download failed (attempt ${_retry}/${_max_retries})"
        if [ ${_retry} -lt ${_max_retries} ]; then
            sleep 5
        fi
    done

    if [ ${_retry} -eq ${_max_retries} ]; then
        echo "ERROR: Failed to download ${_url} after ${_max_retries} attempts"
        return 1
    fi

    verify_sha256 "${_deb_file}" "${_sha256}" || return 1

    echo "  Extracting $(basename "${_deb_file}")..."
    mkdir -p "${_extract_dir}"
    dpkg-deb -x "${_deb_file}" "${_extract_dir}"
    rm -f "${_deb_file}"
}

# Build manifest.json for kernel provisioning (pure shell, no python)
build_manifest_json() {
    _kernels_dir="$1"
    _version="$2"
    _manifest_file="${_kernels_dir}/manifest.json"

    _build_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    # Start JSON
    printf '{\n  "version": "%s",\n  "buildDate": "%s",\n  "variants": {\n' \
        "${_version}" "${_build_date}" > "${_manifest_file}"

    _first_variant=true
    for _variant in stable longterm legacy; do
        _var_dir="${_kernels_dir}/${_variant}"
        [ -d "${_var_dir}" ] || continue

        if [ "${_first_variant}" = "true" ]; then
            _first_variant=false
        else
            printf ',\n' >> "${_manifest_file}"
        fi

        printf '    "%s": {\n' "${_variant}" >> "${_manifest_file}"

        _first_file=true
        for _f in linbo64 modules.tar.xz version; do
            _fp="${_var_dir}/${_f}"
            [ -f "${_fp}" ] || continue

            if [ "${_first_file}" = "true" ]; then
                _first_file=false
            else
                printf ',\n' >> "${_manifest_file}"
            fi

            _hash=$(sha256sum "${_fp}" | cut -d' ' -f1)
            _size=$(stat -c%s "${_fp}" 2>/dev/null || stat -f%z "${_fp}" 2>/dev/null)
            printf '      "%s": {"sha256": "%s", "size": %s}' "${_f}" "${_hash}" "${_size}" >> "${_manifest_file}"
        done

        printf '\n    }' >> "${_manifest_file}"
    done

    printf '\n  },\n  "template": {' >> "${_manifest_file}"

    _template="${_kernels_dir}/linbofs64.xz"
    if [ -f "${_template}" ]; then
        _hash=$(sha256sum "${_template}" | cut -d' ' -f1)
        _size=$(stat -c%s "${_template}" 2>/dev/null || stat -f%z "${_template}" 2>/dev/null)
        printf '"sha256": "%s", "size": %s' "${_hash}" "${_size}" >> "${_manifest_file}"
    fi

    printf '}\n}\n' >> "${_manifest_file}"
}

# Merge GRUB files: overwrite normal files, protect x86_64-efi/ and i386-pc/
merge_grub_files() {
    _src="$1"
    _dst="$2"

    mkdir -p "${_dst}"

    for _entry in "${_src}"/*; do
        [ -e "${_entry}" ] || continue
        _name=$(basename "${_entry}")
        _dst_path="${_dst}/${_name}"

        if [ -d "${_entry}" ]; then
            # Protected dirs: only add files that don't exist
            if [ "${_name}" = "x86_64-efi" ] || [ "${_name}" = "i386-pc" ]; then
                mkdir -p "${_dst_path}"
                for _f in "${_entry}"/*; do
                    [ -f "${_f}" ] || continue
                    _fname=$(basename "${_f}")
                    if [ ! -f "${_dst_path}/${_fname}" ]; then
                        cp "${_f}" "${_dst_path}/${_fname}"
                    fi
                done
            else
                # Recurse for other subdirs
                merge_grub_files "${_entry}" "${_dst_path}"
            fi
        else
            # Normal file: overwrite
            cp "${_entry}" "${_dst_path}"
        fi
    done
}

# Provision boot files from extracted linuxmuster-linbo7 .deb
provision_boot_files() {
    _extract_dir="$1"
    _version="$2"

    echo ""
    echo "=== Provisioning Boot Files ==="

    _srv="${_extract_dir}/srv/linbo"
    _var="${_extract_dir}/var/lib/linuxmuster/linbo"

    # 1. GRUB: merge files (protect module dirs)
    if [ -d "${_srv}/boot/grub" ]; then
        echo "  Merging GRUB files..."
        mkdir -p "${LINBO_DIR}/boot/grub"
        merge_grub_files "${_srv}/boot/grub" "${LINBO_DIR}/boot/grub"
    fi

    # 1b. GRUB modules: linbo7 deb ships empty dirs — filled by step 1c from pre-built Debian GRUB
    for _arch_dir in i386-pc x86_64-efi; do
        _grub_dst="${LINBO_DIR}/boot/grub/${_arch_dir}"
        _mod_count=$(find "${_grub_dst}" -name '*.mod' 2>/dev/null | wc -l)
        if [ "${_mod_count}" -gt 0 ]; then
            echo "  GRUB modules ${_arch_dir}: ${_mod_count} already present"
        else
            echo "  GRUB modules ${_arch_dir}: empty (will be filled in step 1c)"
        fi
    done

    # 1c. Install pre-built GRUB netboot core images (core.0 for BIOS, core.efi for EFI)
    # These are the PXE bootloader files that DHCP points clients to.
    # Built in the Dockerfile grub-builder stage using Debian/Ubuntu GRUB 2.12.
    # Alpine GRUB 2.06 produces core.efi that breaks UEFI PCI device enumeration,
    # so we use Debian GRUB which matches the reference LMN server.
    _prebuilt_grub="/opt/grub-netboot"
    if [ -d "${_prebuilt_grub}" ]; then
        echo "  Installing pre-built Debian GRUB netboot images..."

        # Copy core images (these are the critical PXE bootloader files)
        for _arch_dir in i386-pc x86_64-efi; do
            _src="${_prebuilt_grub}/${_arch_dir}"
            _dst="${LINBO_DIR}/boot/grub/${_arch_dir}"
            if [ -d "${_src}" ]; then
                mkdir -p "${_dst}"
                # Copy core images (always overwrite with Debian-built versions)
                for _core in core.0 core.min core.efi core.iso; do
                    if [ -f "${_src}/${_core}" ]; then
                        cp "${_src}/${_core}" "${_dst}/${_core}"
                        echo "    ${_arch_dir}/${_core} installed ($(stat -c%s "${_dst}/${_core}") bytes)"
                    fi
                done
                # Copy module files (only if not already present from linbo7 .deb)
                _mod_count=$(find "${_dst}" -name '*.mod' 2>/dev/null | wc -l)
                if [ "${_mod_count}" -eq 0 ]; then
                    cp "${_src}"/*.mod "${_dst}/" 2>/dev/null || true
                    cp "${_src}"/*.lst "${_dst}/" 2>/dev/null || true
                    _new_count=$(find "${_dst}" -name '*.mod' 2>/dev/null | wc -l)
                    echo "    ${_arch_dir}: ${_new_count} Debian GRUB modules copied"
                fi
            fi
        done

        # Copy fonts if present
        if [ -d "${_prebuilt_grub}/fonts" ]; then
            mkdir -p "${LINBO_DIR}/boot/grub/fonts"
            cp "${_prebuilt_grub}/fonts"/* "${LINBO_DIR}/boot/grub/fonts/" 2>/dev/null || true
        fi
    else
        echo "  WARNING: Pre-built Debian GRUB not found at ${_prebuilt_grub}"
        echo "  GRUB core images will NOT be built. PXE boot may not work."
    fi

    # 2. Icons
    if [ -d "${_srv}/icons" ]; then
        echo "  Copying icons..."
        cp -r "${_srv}/icons" "${LINBO_DIR}/"
    fi

    # 3. start.conf (default, only if not exists)
    if [ -f "${_srv}/start.conf" ] && [ ! -f "${LINBO_DIR}/start.conf" ]; then
        cp "${_srv}/start.conf" "${LINBO_DIR}/start.conf"
        echo "  Default start.conf installed"
    fi

    # 4. Kernel variants → kernels/
    KERNELS_DIR="${LINBO_DIR}/kernels"
    mkdir -p "${KERNELS_DIR}"

    for _variant in stable longterm legacy; do
        if [ -d "${_var}/${_variant}" ]; then
            echo "  Kernel variant: ${_variant}"
            cp -r "${_var}/${_variant}" "${KERNELS_DIR}/"
        fi
    done

    # 5. linbofs64.xz template
    if [ -f "${_var}/linbofs64.xz" ]; then
        cp "${_var}/linbofs64.xz" "${KERNELS_DIR}/linbofs64.xz"
        echo "  linbofs64.xz template stored"
    fi

    # 6. Build manifest.json for kernel provisioning
    build_manifest_json "${KERNELS_DIR}" "${_version}"
    echo "  manifest.json built"

    # 7. Other boot files from /srv/linbo/ (linbo.iso, german.kbd, etc.)
    for _f in "${_srv}"/*; do
        [ -f "${_f}" ] || continue
        _fname=$(basename "${_f}")
        # Skip files we handle separately or that should not be overwritten
        case "${_fname}" in
            linbo_gui64_7.tar.lz*|start.conf*|linbo-version*) continue ;;
        esac
        cp "${_f}" "${LINBO_DIR}/${_fname}"
    done
    echo "  Boot files copied"
}

# Provision GUI from extracted linuxmuster-linbo-gui7 .deb
provision_gui() {
    _extract_dir="$1"

    echo ""
    echo "=== Provisioning GUI ==="

    _srv="${_extract_dir}/srv/linbo"

    # 1. GUI archive + md5
    for _f in linbo_gui64_7.tar.lz linbo_gui64_7.tar.lz.md5; do
        if [ -f "${_srv}/${_f}" ]; then
            cp "${_srv}/${_f}" "${LINBO_DIR}/${_f}"
            echo "  ${_f} installed"
        fi
    done

    # 2. Icons (GUI package may also ship icons)
    if [ -d "${_srv}/icons" ]; then
        cp -r "${_srv}/icons" "${LINBO_DIR}/"
    fi

    # 3. gui/ symlinks (new LINBO versions look for gui/linbo_gui64_7.tar.lz)
    if [ -f "${LINBO_DIR}/linbo_gui64_7.tar.lz" ]; then
        mkdir -p "${LINBO_DIR}/gui"
        ln -sf "${LINBO_DIR}/linbo_gui64_7.tar.lz" "${LINBO_DIR}/gui/linbo_gui64_7.tar.lz"
        ln -sf "${LINBO_DIR}/linbo_gui64_7.tar.lz.md5" "${LINBO_DIR}/gui/linbo_gui64_7.tar.lz.md5" 2>/dev/null || true
        if [ -d "${LINBO_DIR}/icons" ]; then
            ln -sfn "${LINBO_DIR}/icons" "${LINBO_DIR}/gui/icons"
        fi
        chown -h 1001:1001 "${LINBO_DIR}/gui"/* 2>/dev/null || true
        echo "  GUI symlinks created"
    fi
}

# =============================================================================
# Kernel Variant Provisioning (Atomic Symlink-Swap)
# =============================================================================

provision_kernels() {
    KERNEL_SRC="${LINBO_DIR}/kernels"
    MANIFEST_FILE="${KERNEL_SRC}/manifest.json"
    PROVISION_MARKER="${KERNEL_DIR}/.provisioned-version"
    PROVISION_LOCK="${KERNEL_DIR}/.provision.lock"
    SETS_DIR="${KERNEL_DIR}/sets"

    # Check if kernel variants exist in boot files
    if [ ! -f "${MANIFEST_FILE}" ]; then
        echo "No kernel manifest found, skipping kernel provisioning"
        echo "(This is normal for older boot file releases)"
        return 0
    fi

    echo ""
    echo "=== Kernel Variant Provisioning ==="

    # Calculate manifest hash for versioning
    MANIFEST_HASH=$(sha256sum "${MANIFEST_FILE}" | cut -c1-8)
    echo "Manifest hash: ${MANIFEST_HASH}"

    # Check if already provisioned with same manifest
    if [ -f "${PROVISION_MARKER}" ]; then
        EXISTING_HASH=$(grep -o '"manifestHash":"[^"]*"' "${PROVISION_MARKER}" | cut -d'"' -f4 2>/dev/null || echo "")
        if [ "${EXISTING_HASH}" = "${MANIFEST_HASH}" ] && [ "${FORCE_UPDATE}" != "true" ]; then
            echo "Kernel variants already provisioned (hash: ${MANIFEST_HASH})"
            return 0
        fi
    fi

    # Cleanup stale temp dirs from previous crashed runs
    if [ -d "${SETS_DIR}" ]; then
        for tmpdir in "${SETS_DIR}"/.tmp-*; do
            if [ -d "$tmpdir" ]; then
                rm -rf "$tmpdir"
                echo "Cleaned up stale temp: $tmpdir"
            fi
        done
    fi

    # Acquire lock (non-blocking, fail if locked)
    mkdir -p "${KERNEL_DIR}"
    exec 9>"${PROVISION_LOCK}"
    if ! flock -n 9; then
        echo "WARNING: Another provisioning process is running, skipping"
        return 0
    fi

    echo "Provisioning kernel variants..."
    NEW_SET_DIR="${SETS_DIR}/${MANIFEST_HASH}"
    TEMP_SET_DIR="${SETS_DIR}/.tmp-${MANIFEST_HASH}"

    # Extract into temp directory (same filesystem for atomic rename)
    mkdir -p "${TEMP_SET_DIR}"

    for variant in stable longterm legacy; do
        SRC_DIR="${KERNEL_SRC}/${variant}"
        DST_DIR="${TEMP_SET_DIR}/${variant}"

        if [ -d "${SRC_DIR}" ]; then
            mkdir -p "${DST_DIR}"
            for f in linbo64 modules.tar.xz version; do
                if [ -f "${SRC_DIR}/${f}" ]; then
                    cp "${SRC_DIR}/${f}" "${DST_DIR}/${f}"
                fi
            done
            KVER=$(cat "${DST_DIR}/version" 2>/dev/null || echo "unknown")
            echo "  - ${variant}: ${KVER}"
        fi
    done

    # Copy linbofs64.xz template
    if [ -f "${KERNEL_SRC}/linbofs64.xz" ]; then
        cp "${KERNEL_SRC}/linbofs64.xz" "${TEMP_SET_DIR}/linbofs64.xz"
        echo "  - linbofs64.xz template copied"
    fi

    # Copy manifest
    cp "${MANIFEST_FILE}" "${TEMP_SET_DIR}/manifest.json"

    # Verify against manifest (sha256)
    echo "Verifying checksums..."
    VERIFY_OK=true
    for variant in stable longterm legacy; do
        for f in linbo64 modules.tar.xz version; do
            FPATH="${TEMP_SET_DIR}/${variant}/${f}"
            if [ -f "${FPATH}" ]; then
                EXPECTED=""
                # Parse expected hash from manifest using awk
                EXPECTED=$(awk -v var="${variant}" -v file="${f}" '
                    BEGIN { in_var=0; in_file=0 }
                    /"'${variant}'"/ { in_var=1 }
                    in_var && /"'${f}'"/ { in_file=1 }
                    in_file && /"sha256"/ {
                        gsub(/.*"sha256"[[:space:]]*:[[:space:]]*"/, "")
                        gsub(/".*/, "")
                        print
                        exit
                    }
                ' "${MANIFEST_FILE}" 2>/dev/null || echo "")
                if [ -n "${EXPECTED}" ]; then
                    ACTUAL=$(sha256sum "${FPATH}" | cut -d' ' -f1)
                    if [ "${ACTUAL}" != "${EXPECTED}" ]; then
                        echo "ERROR: Checksum mismatch for ${variant}/${f}"
                        echo "  Expected: ${EXPECTED}"
                        echo "  Actual:   ${ACTUAL}"
                        VERIFY_OK=false
                    fi
                fi
            fi
        done
    done

    if [ "${VERIFY_OK}" != "true" ]; then
        echo "ERROR: Verification failed, aborting provisioning"
        rm -rf "${TEMP_SET_DIR}"
        flock -u 9
        return 1
    fi
    echo "  Checksums OK"

    # Atomic rename: temp -> final set directory
    if [ -d "${NEW_SET_DIR}" ]; then
        rm -rf "${NEW_SET_DIR}"
    fi
    mv "${TEMP_SET_DIR}" "${NEW_SET_DIR}"

    # Atomic symlink swap
    if [ -d "${KERNEL_DIR}/current" ] && [ ! -L "${KERNEL_DIR}/current" ]; then
        rm -rf "${KERNEL_DIR}/current"
    fi
    ln -sfn "sets/${MANIFEST_HASH}" "${KERNEL_DIR}/current.new"
    mv -f "${KERNEL_DIR}/current.new" "${KERNEL_DIR}/current" 2>/dev/null \
        || { rm -f "${KERNEL_DIR}/current" 2>/dev/null; mv "${KERNEL_DIR}/current.new" "${KERNEL_DIR}/current"; }

    # Write provisioned marker (crash-safe: write temp + rename)
    MARKER_TMP="${PROVISION_MARKER}.tmp"
    printf '{"version":"%s","manifestHash":"%s","timestamp":"%s"}\n' \
        "${VERSION:-unknown}" "${MANIFEST_HASH}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        > "${MARKER_TMP}"
    mv "${MARKER_TMP}" "${PROVISION_MARKER}"

    # Cleanup old sets (keep only current)
    CURRENT_TARGET=$(readlink "${KERNEL_DIR}/current" 2>/dev/null | sed 's|^sets/||')
    if [ -d "${SETS_DIR}" ] && [ -n "${CURRENT_TARGET}" ]; then
        for old_set in "${SETS_DIR}"/*/; do
            OLD_NAME=$(basename "$old_set")
            if [ "${OLD_NAME}" != "${CURRENT_TARGET}" ]; then
                rm -rf "$old_set"
                echo "  Cleaned up old set: ${OLD_NAME}"
            fi
        done
    fi

    # Set permissions
    chown -R 1001:1001 "${KERNEL_DIR}"

    # Release lock
    flock -u 9

    echo "=== Kernel variants provisioned successfully ==="
    echo "Active set: ${MANIFEST_HASH}"
    ls -la "${KERNEL_DIR}/current/" 2>/dev/null || true
}

# =============================================================================
# GUI Theme Provisioning
# =============================================================================

provision_themes() {
    THEMES_SRC="/opt/linbo-themes"
    THEMES_DST="${LINBO_DIR}/gui-themes"

    if [ -d "${THEMES_SRC}" ] && [ "$(ls -A "${THEMES_SRC}" 2>/dev/null)" ]; then
        echo ""
        echo "=== GUI Theme Provisioning ==="
        mkdir -p "${THEMES_DST}"
        for theme_dir in "${THEMES_SRC}"/*/; do
            [ -d "$theme_dir" ] || continue
            theme_name=$(basename "$theme_dir")
            mkdir -p "${THEMES_DST}/${theme_name}"
            cp -r "${theme_dir}"* "${THEMES_DST}/${theme_name}/"
            echo "  - Theme: ${theme_name}"
        done
        chown -R 1001:1001 "${THEMES_DST}"
        echo "GUI themes provisioned to ${THEMES_DST}"
    fi
}

# =============================================================================
# GRUB Theme Provisioning (self-healing, runs regardless of checkpoints)
# =============================================================================

ensure_grub_themes() {
    _theme_dir="${LINBO_DIR}/boot/grub/themes/linbo"

    # Check: theme.txt + font present?
    if [ -f "${_theme_dir}/theme.txt" ] && [ -f "${_theme_dir}/unifont-regular-16.pf2" ]; then
        return 0
    fi

    echo "  GRUB themes missing, provisioning from cached .deb..."

    # Extract themes from cached .deb
    _deb_file=$(ls "${CACHE_DIR}/debs"/linuxmuster-linbo7_*.deb 2>/dev/null | head -1)
    if [ -z "${_deb_file}" ]; then
        echo "  WARNING: No cached .deb found for GRUB theme provisioning"
        return 1
    fi

    _tmp=$(mktemp -d)
    dpkg-deb -x "${_deb_file}" "${_tmp}"

    _theme_src="${_tmp}/srv/linbo/boot/grub/themes"
    if [ -d "${_theme_src}" ]; then
        cp -r "${_theme_src}" "${LINBO_DIR}/boot/grub/"
        chown -R 1001:1001 "${LINBO_DIR}/boot/grub/themes"
        echo "  GRUB themes provisioned successfully"
    else
        echo "  WARNING: No themes directory in .deb package"
    fi

    rm -rf "${_tmp}"
}

# =============================================================================
# Main Flow (checkpoint-aware, resumable)
# =============================================================================

# --- Step 0: Setup ---
echo "=== LINBO Init (APT-based) ==="
echo "Target directory: ${LINBO_DIR}"
echo "Kernel directory: ${KERNEL_DIR}"
echo "APT source: ${DEB_BASE_URL} (dist: ${DEB_DIST})"

# --- Step 1: Pre-flight checks ---
echo ""
echo "=== Pre-flight checks ==="

if ! check_write_permission "${LINBO_DIR}"; then
    exit 1
fi

if ! check_disk_space; then
    exit 1
fi

if ! check_dns; then
    exit 1
fi

echo "  All pre-flight checks passed"

# --- Step 2: FORCE_UPDATE handling ---
if [ "${FORCE_UPDATE}" = "true" ]; then
    echo ""
    echo "Forcing full update -- all checkpoints cleared"
    checkpoint_clear_all
fi

# --- Step 3: APT index fetch (checkpointed as "apt-index") ---
echo ""
PACKAGES_CACHE=""

if checkpoint_exists "apt-index" && [ "${FORCE_UPDATE}" != "true" ]; then
    echo "Skipping: APT index already fetched"
    # Still need to fetch for version info parsing
    if ! fetch_packages_index; then
        exit 1
    fi
else
    echo "=== Fetching APT index ==="
    if ! fetch_packages_index; then
        exit 1
    fi
    checkpoint_set "apt-index" "fetched"
fi

# Parse package info (always needed for version/filename/sha256)
echo ""
echo "=== Checking packages ==="

if ! parse_package_info "${LINBO_PKG}"; then
    error_block \
        "Package not found" \
        "Package: ${LINBO_PKG}" \
        "Package not found in APT index" \
        "" \
        "Check DEB_BASE_URL and DEB_DIST environment variables"
    exit 1
fi
LINBO_VERSION="${PKG_VERSION}"
LINBO_FILENAME="${PKG_FILENAME}"
LINBO_SHA256="${PKG_SHA256}"

if [ -f "${LOCAL_GUI_DEB}" ] && [ ! -f "${LOCAL_GUI_DEB}.skip" ]; then
    echo "  Using edulution GUI package: ${LOCAL_GUI_DEB}"
    GUI_VERSION="local"
    GUI_FILENAME=""
    GUI_SHA256=""
else
    if ! parse_package_info "${GUI_PKG}"; then
        error_block \
            "Package not found" \
            "Package: ${GUI_PKG}" \
            "Package not found in APT index" \
            "" \
            "Check DEB_BASE_URL and DEB_DIST environment variables"
        exit 1
    fi
    GUI_VERSION="${PKG_VERSION}"
    GUI_FILENAME="${PKG_FILENAME}"
    GUI_SHA256="${PKG_SHA256}"
fi

# Cleanup Packages cache
rm -f "${PACKAGES_CACHE}"

# --- Step 4: Version detection and checkpoint invalidation ---
INSTALLED_VERSION=""
if [ -f "${VERSION_FILE}" ]; then
    INSTALLED_VERSION=$(cat "${VERSION_FILE}")
fi

INSTALLED_VER=""
if [ -n "${INSTALLED_VERSION}" ]; then
    INSTALLED_VER=$(echo "${INSTALLED_VERSION}" | sed -n 's/^LINBO[[:space:]]*\([^:[:space:]]*\).*/\1/p')
    echo ""
    echo "Installed: ${INSTALLED_VER}"
fi

if [ -n "${INSTALLED_VER}" ] && [ "${INSTALLED_VER}" != "${LINBO_VERSION}" ]; then
    echo ""
    echo "Version change detected: ${INSTALLED_VER} -> ${LINBO_VERSION}, clearing checkpoints"
    # Clear all checkpoints except apt-index (we just fetched it)
    for _ckpt_file in "${CHECKPOINT_DIR}"/*; do
        [ -f "${_ckpt_file}" ] || continue
        _ckpt_name=$(basename "${_ckpt_file}")
        if [ "${_ckpt_name}" != "apt-index" ]; then
            rm -f "${_ckpt_file}"
        fi
    done
fi

# Check if all work is already done (same version, not forced, all checkpoints present)
if [ -n "${INSTALLED_VER}" ] && [ "${INSTALLED_VER}" = "${LINBO_VERSION}" ] && [ "${FORCE_UPDATE}" != "true" ]; then
    if checkpoint_exists "boot-files" && checkpoint_exists "kernels" && checkpoint_exists "themes"; then
        echo ""
        echo "Already up to date (version: ${LINBO_VERSION}), all checkpoints present"
        echo "Set FORCE_UPDATE=true to force re-install"
        # Still run kernels and themes in case volume state drifted
        provision_kernels
        provision_themes
        ensure_grub_themes
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))
        print_success_summary "${LINBO_VERSION}" "${DURATION}"
        exit 0
    fi
fi

if [ -n "${INSTALLED_VER}" ] && [ "${INSTALLED_VER}" != "${LINBO_VERSION}" ]; then
    echo "Update available: ${INSTALLED_VER} -> ${LINBO_VERSION}"
elif [ -z "${INSTALLED_VER}" ]; then
    echo ""
    echo "Fresh install: ${LINBO_VERSION}"
fi

# --- Step 5: Resume detection ---
RESUMING=false
if has_any_checkpoint; then
    RESUMING=true
    echo ""
    echo "=== Resuming from partial install (version ${LINBO_VERSION}) ==="
fi

# --- Step 6: Download LINBO .deb (checkpointed as "linbo-deb") ---
echo ""
LINBO_DEB_BASENAME=$(basename "${LINBO_FILENAME}")

if checkpoint_exists "linbo-deb" && checkpoint_version_match "linbo-deb" "${LINBO_VERSION}"; then
    echo "Skipping: LINBO .deb already downloaded (${LINBO_VERSION}, SHA256 OK)"
else
    echo "=== Downloading LINBO package ==="
    mkdir -p "${CACHE_DIR}"
    if ! download_and_cache_deb "${LINBO_FILENAME}" "${LINBO_SHA256}" "linuxmuster-linbo7" "debs"; then
        exit 1
    fi
    checkpoint_set "linbo-deb" "${LINBO_VERSION}"
fi

# --- Step 7: Download GUI .deb (checkpointed as "gui-deb") ---
if [ -f "${LOCAL_GUI_DEB}" ]; then
    echo "Skipping GUI download: using local ${LOCAL_GUI_DEB}"
    GUI_DEB_PATH="${LOCAL_GUI_DEB}"
else
    GUI_DEB_BASENAME=$(basename "${GUI_FILENAME}")

    if checkpoint_exists "gui-deb" && checkpoint_version_match "gui-deb" "${LINBO_VERSION}"; then
        echo "Skipping: GUI .deb already downloaded (${LINBO_VERSION}, SHA256 OK)"
    else
        echo "=== Downloading GUI package ==="
        mkdir -p "${CACHE_DIR}"
        if ! download_and_cache_deb "${GUI_FILENAME}" "${GUI_SHA256}" "linuxmuster-linbo-gui7" "debs"; then
            exit 1
        fi
        checkpoint_set "gui-deb" "${LINBO_VERSION}"
    fi
    GUI_DEB_PATH="${CACHE_DIR}/debs/${GUI_DEB_BASENAME}"
fi

# --- Step 8: Extract and provision boot files (checkpointed as "boot-files") ---
echo ""

if checkpoint_exists "boot-files" && checkpoint_version_match "boot-files" "${LINBO_VERSION}"; then
    echo "Skipping: Boot files already provisioned (${LINBO_VERSION})"
else
    echo "=== Extracting and provisioning boot files ==="
    TEMP_DIR=$(mktemp -d)
    mkdir -p "${LINBO_DIR}"

    # Extract LINBO .deb from cache
    LINBO_EXTRACT="${TEMP_DIR}/linbo7"
    if ! dpkg-deb -x "${CACHE_DIR}/debs/${LINBO_DEB_BASENAME}" "${LINBO_EXTRACT}"; then
        error_block \
            "Extraction failed" \
            "Package: ${LINBO_DEB_BASENAME}
File:    ${CACHE_DIR}/debs/${LINBO_DEB_BASENAME}" \
            "dpkg-deb could not extract the LINBO package" \
            "" \
            "Delete the cached file and retry: rm ${CACHE_DIR}/debs/${LINBO_DEB_BASENAME}"
        rm -rf "${TEMP_DIR}"
        exit 1
    fi

    # Provision boot files
    if ! provision_boot_files "${LINBO_EXTRACT}" "${LINBO_VERSION}"; then
        error_block \
            "Boot file provisioning failed" \
            "Version: ${LINBO_VERSION}" \
            "Could not provision boot files from extracted package" \
            "" \
            "Check disk space and permissions on ${LINBO_DIR}"
        rm -rf "${TEMP_DIR}"
        exit 1
    fi

    # Extract GUI .deb
    GUI_EXTRACT="${TEMP_DIR}/gui7"
    if ! dpkg-deb -x "${GUI_DEB_PATH}" "${GUI_EXTRACT}"; then
        error_block \
            "Extraction failed" \
            "Package: $(basename "${GUI_DEB_PATH}")
File:    ${GUI_DEB_PATH}" \
            "dpkg-deb could not extract the GUI package" \
            "" \
            "Check the GUI .deb file: ${GUI_DEB_PATH}"
        rm -rf "${TEMP_DIR}"
        exit 1
    fi

    # Provision GUI
    if ! provision_gui "${GUI_EXTRACT}"; then
        error_block \
            "GUI provisioning failed" \
            "Version: ${LINBO_VERSION}" \
            "Could not provision GUI from extracted package" \
            "" \
            "Check disk space and permissions on ${LINBO_DIR}"
        rm -rf "${TEMP_DIR}"
        exit 1
    fi

    # Set .needs-rebuild marker
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${LINBO_DIR}/.needs-rebuild"
    chmod 664 "${LINBO_DIR}/.needs-rebuild"
    chown 1001:1001 "${LINBO_DIR}/.needs-rebuild"
    echo "Rebuild marker set -- API will rebuild linbofs64 on startup"

    # Write version markers
    LINBO_VERSION_SRC="${LINBO_EXTRACT}/srv/linbo/linbo-version"
    if [ -f "${LINBO_VERSION_SRC}" ]; then
        cp "${LINBO_VERSION_SRC}" "${VERSION_FILE}"
        cp "${LINBO_VERSION_SRC}" "${LINBO_DIR}/linbo-version.txt"
    else
        echo "LINBO ${LINBO_VERSION}" > "${VERSION_FILE}"
        echo "LINBO ${LINBO_VERSION}" > "${LINBO_DIR}/linbo-version.txt"
    fi

    # Write .boot-files-installed marker for backwards compat
    echo "${LINBO_VERSION}" > "${LINBO_DIR}/.boot-files-installed"

    # Set permissions
    chmod -R 755 "${LINBO_DIR}"
    chown -R 1001:1001 "${LINBO_DIR}"

    # Cleanup temp
    rm -rf "${TEMP_DIR}"

    checkpoint_set "boot-files" "${LINBO_VERSION}"
    echo ""
    echo "Boot files provisioned successfully"
fi

# Ensure GRUB themes are present (self-healing, independent of checkpoint)
ensure_grub_themes

# --- Step 9: Provision kernels (checkpointed as "kernels") ---
echo ""

if checkpoint_exists "kernels" && checkpoint_version_match "kernels" "${LINBO_VERSION}"; then
    echo "Skipping: Kernels already provisioned (${LINBO_VERSION})"
else
    if ! provision_kernels; then
        error_block \
            "Kernel provisioning failed" \
            "Version: ${LINBO_VERSION}" \
            "Could not provision kernel variants" \
            "" \
            "Check disk space and permissions on ${KERNEL_DIR}"
        exit 1
    fi
    checkpoint_set "kernels" "${LINBO_VERSION}"
fi

# Fix permissions on driver volume
DRIVER_DIR="/var/lib/linbo/drivers"
if [ -d "${DRIVER_DIR}" ]; then
    chown 1001:1001 "${DRIVER_DIR}"
    echo "Driver volume permissions set (1001:1001)"
fi

# --- Step 10: Provision themes (checkpointed as "themes") ---
echo ""

if checkpoint_exists "themes" && checkpoint_version_match "themes" "${LINBO_VERSION}"; then
    echo "Skipping: Themes already provisioned (${LINBO_VERSION})"
else
    provision_themes
    checkpoint_set "themes" "${LINBO_VERSION}"
fi

# --- Step 11: Success summary ---
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
print_success_summary "${LINBO_VERSION}" "${DURATION}"

exit 0
