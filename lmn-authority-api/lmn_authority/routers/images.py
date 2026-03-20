"""Image manifest, download, and upload endpoints for LINBO image sync."""

from __future__ import annotations

import hashlib
import logging
import os
import re
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/linbo/images", tags=["images"])

IMAGES_DIR = Path("/srv/linbo/images")
INCOMING_DIR = IMAGES_DIR / ".incoming"

# In-memory cache (60s TTL)
_manifest_cache: dict | None = None
_manifest_cache_time: float = 0.0
_CACHE_TTL = 60.0

_SAFE_NAME_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
_SAFE_FILENAME_RE = re.compile(r"^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_.]+$")


def _parse_info(info_path: Path) -> dict:
    """Parse a LINBO .info file into a dict.

    Format:
        ["image.qcow2" Info File]
        timestamp="202511101136"
        image="image.qcow2"
        imagesize="4332732928"
    """
    result = {}
    try:
        for line in info_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if "=" not in line or line.startswith("["):
                continue
            key, _, value = line.partition("=")
            result[key.strip()] = value.strip().strip('"')
    except Exception:
        pass
    return result


def _read_md5(md5_path: Path) -> str | None:
    """Read an MD5 sidecar. Handles both 'hash' and 'hash  filename' formats."""
    try:
        content = md5_path.read_text(encoding="utf-8").strip()
        if content:
            return content.split()[0]
    except Exception:
        pass
    return None


def _scan_images() -> list[dict]:
    """Scan IMAGES_DIR for image subdirectories and build manifest."""
    if not IMAGES_DIR.is_dir():
        return []

    images = []
    for entry in sorted(IMAGES_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue

        # List files (skip subdirectories like backups/)
        files = []
        total_size = 0
        qcow2_file = None
        for f in sorted(entry.iterdir()):
            if not f.is_file():
                continue
            try:
                st = f.stat()
            except OSError:
                continue
            files.append({"name": f.name, "size": st.st_size})
            total_size += st.st_size
            if f.suffix == ".qcow2":
                qcow2_file = f.name

        if not qcow2_file:
            continue  # Skip directories without a qcow2

        # Parse .info
        info_path = entry / f"{qcow2_file}.info"
        info = _parse_info(info_path) if info_path.exists() else {}

        # Read .md5 checksum
        md5_path = entry / f"{qcow2_file}.md5"
        checksum = _read_md5(md5_path)

        images.append({
            "name": entry.name,
            "filename": qcow2_file,
            "totalSize": total_size,
            "files": files,
            "timestamp": info.get("timestamp"),
            "imagesize": info.get("imagesize"),
            "checksum": checksum,
        })

    return images


def _get_manifest() -> list[dict]:
    """Get image manifest with 60s cache."""
    global _manifest_cache, _manifest_cache_time
    now = time.monotonic()
    if _manifest_cache is not None and (now - _manifest_cache_time) < _CACHE_TTL:
        return _manifest_cache
    _manifest_cache = _scan_images()
    _manifest_cache_time = now
    return _manifest_cache


@router.get("/manifest")
async def get_manifest():
    """Return manifest of all available images with sizes and checksums."""
    images = _get_manifest()
    return {"images": images}


def _validate_path(name: str, filename: str) -> Path | None:
    """Validate and resolve a safe file path. Returns None if invalid."""
    if not _SAFE_NAME_RE.match(name) or not _SAFE_FILENAME_RE.match(filename):
        return None
    resolved = (IMAGES_DIR / name / filename).resolve()
    # Ensure the resolved path is under IMAGES_DIR
    if not str(resolved).startswith(str(IMAGES_DIR.resolve())):
        return None
    if not resolved.is_file():
        return None
    return resolved


@router.api_route("/download/{name}/{filename}", methods=["GET", "HEAD"])
async def download_image_file(name: str, filename: str, request: Request):
    """Download an image file with Range support (via FileResponse).

    FileResponse automatically handles:
    - Range header → 206 Partial Content
    - ETag and Last-Modified headers
    - Accept-Ranges: bytes header

    HEAD is supported for pre-flight size/etag checks.
    """
    safe = _validate_path(name, filename)
    if safe is None:
        return JSONResponse(
            status_code=404,
            content={"error": "NOT_FOUND", "message": f"File not found: {name}/{filename}"},
        )
    stat = os.stat(safe)
    return FileResponse(
        path=str(safe),
        filename=filename,
        stat_result=stat,
        media_type="application/octet-stream",
    )


# ---------------------------------------------------------------------------
# Upload endpoints (push images from Docker back to this server)
# ---------------------------------------------------------------------------

def _invalidate_manifest_cache() -> None:
    """Force manifest cache refresh on next request."""
    global _manifest_cache
    _manifest_cache = None


def _validate_upload_path(name: str, filename: str) -> Path | None:
    """Validate upload target path. File need not exist yet."""
    if not _SAFE_NAME_RE.match(name) or not _SAFE_FILENAME_RE.match(filename):
        return None
    resolved = (IMAGES_DIR / name / filename).resolve()
    if not str(resolved).startswith(str(IMAGES_DIR.resolve())):
        return None
    return resolved


def _compute_md5(file_path: Path) -> str:
    """Compute MD5 hash of a file."""
    h = hashlib.md5()
    with open(file_path, "rb") as f:
        while True:
            chunk = f.read(8 * 1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


@router.put("/upload/{name}/{filename}")
async def upload_image_chunk(name: str, filename: str, request: Request):
    """Upload an image file (or chunk) with optional Content-Range for resume.

    Without Content-Range: complete file upload in a single request.
    With Content-Range (bytes {start}-{end}/{total}): chunked/resumable upload.

    The server writes to .incoming/{name}/{filename}.part and renames to
    the final name when the upload is complete (end+1 == total).
    """
    target = _validate_upload_path(name, filename)
    if target is None:
        return JSONResponse(
            status_code=400,
            content={"error": "INVALID_PATH", "message": f"Invalid name or filename: {name}/{filename}"},
        )

    staging_dir = INCOMING_DIR / name
    staging_dir.mkdir(parents=True, exist_ok=True)
    part_path = staging_dir / f"{filename}.part"

    content_range = request.headers.get("content-range")
    body = await request.body()

    if content_range:
        # Parse: "bytes {start}-{end}/{total}"
        m = re.match(r"bytes (\d+)-(\d+)/(\d+)", content_range)
        if not m:
            return JSONResponse(
                status_code=400,
                content={"error": "INVALID_RANGE", "message": f"Cannot parse Content-Range: {content_range}"},
            )
        start, end, total = int(m.group(1)), int(m.group(2)), int(m.group(3))

        # Validate offset matches existing .part file
        current_size = part_path.stat().st_size if part_path.exists() else 0
        if start != current_size:
            return JSONResponse(
                status_code=409,
                content={
                    "error": "OFFSET_MISMATCH",
                    "message": f"Expected offset {current_size}, got {start}",
                    "bytesReceived": current_size,
                },
            )

        # Validate body length matches range
        expected_len = end - start + 1
        if len(body) != expected_len:
            return JSONResponse(
                status_code=400,
                content={"error": "LENGTH_MISMATCH", "message": f"Expected {expected_len} bytes, got {len(body)}"},
            )

        # Append chunk
        with open(part_path, "ab") as f:
            f.write(body)

        received = start + len(body)
        complete = received >= total

        if complete:
            # Rename .part → final in staging dir
            final_path = staging_dir / filename
            part_path.rename(final_path)
            logger.info("Upload complete: %s/%s (%d bytes)", name, filename, total)

        return JSONResponse(
            status_code=200 if complete else 202,
            content={"bytesReceived": received, "total": total, "complete": complete},
        )
    else:
        # Single-request upload (for sidecars or small files)
        final_path = staging_dir / filename
        with open(final_path, "wb") as f:
            f.write(body)
        logger.info("Upload (single): %s/%s (%d bytes)", name, filename, len(body))
        return {"bytesReceived": len(body), "total": len(body), "complete": True}


@router.get("/upload/{name}/{filename}/status")
async def upload_status(name: str, filename: str):
    """Get the current upload progress for a file (for resume after disconnect).

    Returns the number of bytes already received in the .part file.
    """
    if not _SAFE_NAME_RE.match(name) or not _SAFE_FILENAME_RE.match(filename):
        return JSONResponse(status_code=400, content={"error": "INVALID_PATH", "message": "Invalid name or filename"})

    part_path = INCOMING_DIR / name / f"{filename}.part"
    final_path = INCOMING_DIR / name / filename

    if final_path.exists():
        size = final_path.stat().st_size
        return {"bytesReceived": size, "complete": True}

    if part_path.exists():
        size = part_path.stat().st_size
        return {"bytesReceived": size, "complete": False}

    return {"bytesReceived": 0, "complete": False}


@router.post("/upload/{name}/complete")
async def upload_complete(name: str):
    """Finalize an image upload: move from .incoming to images, generate MD5.

    This performs the atomic swap from the staging directory to the final
    image directory, computes the MD5 checksum, and invalidates the manifest cache.
    """
    if not _SAFE_NAME_RE.match(name):
        return JSONResponse(status_code=400, content={"error": "INVALID_PATH", "message": f"Invalid image name: {name}"})

    staging_dir = INCOMING_DIR / name
    if not staging_dir.is_dir():
        return JSONResponse(
            status_code=404,
            content={"error": "NOT_FOUND", "message": f"No pending upload for image '{name}'"},
        )

    # Verify at least one .qcow2 file exists in staging
    qcow2_files = list(staging_dir.glob("*.qcow2"))
    if not qcow2_files:
        return JSONResponse(
            status_code=400,
            content={"error": "NO_QCOW2", "message": f"No .qcow2 file found in upload for '{name}'"},
        )

    # Check for incomplete .part files
    part_files = list(staging_dir.glob("*.part"))
    if part_files:
        names = [p.name for p in part_files]
        return JSONResponse(
            status_code=409,
            content={"error": "INCOMPLETE_UPLOAD", "message": f"Incomplete files: {names}"},
        )

    # Generate MD5 sidecar for each .qcow2
    for qcow2 in qcow2_files:
        md5_hash = _compute_md5(qcow2)
        md5_path = staging_dir / f"{qcow2.name}.md5"
        md5_path.write_text(f"{md5_hash}  {qcow2.name}\n", encoding="utf-8")
        logger.info("MD5 generated for %s: %s", qcow2.name, md5_hash)

    # Atomic swap: remove old, move staging → final
    target_dir = IMAGES_DIR / name
    if target_dir.exists():
        shutil.rmtree(target_dir)
    staging_dir.rename(target_dir)

    _invalidate_manifest_cache()
    logger.info("Image upload finalized: %s", name)

    # Return updated manifest entry
    images = _get_manifest()
    entry = next((i for i in images if i["name"] == name), None)
    return {"image": entry}


@router.delete("/upload/{name}")
async def upload_cancel(name: str):
    """Cancel a pending upload and remove the staging directory."""
    if not _SAFE_NAME_RE.match(name):
        return JSONResponse(status_code=400, content={"error": "INVALID_PATH", "message": f"Invalid image name: {name}"})

    staging_dir = INCOMING_DIR / name
    if not staging_dir.is_dir():
        return JSONResponse(
            status_code=404,
            content={"error": "NOT_FOUND", "message": f"No pending upload for image '{name}'"},
        )

    shutil.rmtree(staging_dir)
    logger.info("Upload cancelled and cleaned up: %s", name)
    return {"cancelled": True, "name": name}
