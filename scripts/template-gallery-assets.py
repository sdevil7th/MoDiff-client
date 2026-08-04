#!/usr/bin/env python3
"""Build, verify, publish, prune, and restore MoDiff's template Gallery asset set.

The source-code repository stores only a deterministic byte manifest and a
pinned public Hugging Face Dataset location. Asset bytes remain outside Git.
Network operations import huggingface_hub and hf_xet lazily so local inventory
and verification do not require an authenticated Hub environment.
"""

from __future__ import annotations

import argparse
import errno
import hashlib
import json
import mimetypes
import os
import re
import shutil
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable


CLIENT_ROOT = Path(__file__).resolve().parents[1]
GALLERY_ROOT = CLIENT_ROOT / "public" / "template-gallery"
ASSET_MANIFEST_PATH = CLIENT_ROOT / "config" / "template-assets.v1.json"
ASSET_RIGHTS_PATH = CLIENT_ROOT / "config" / "template-asset-rights.v1.json"
SOURCE_CONFIG_PATH = CLIENT_ROOT / "src" / "studio" / "templateAssetSource.json"
DATASET_CARD_PATH = CLIENT_ROOT / "docs" / "template-gallery-dataset-card.md"
DATASET_LICENSE_PATH = CLIENT_ROOT / "docs" / "template-gallery-dataset-license.txt"
SOURCE_EXTENSIONS = {
    ".css",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".mjs",
    ".ts",
    ".tsx",
}
TOOLING_EXTENSIONS = {
    ".cjs",
    ".js",
    ".json",
    ".mjs",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".yaml",
    ".yml",
}


def is_test_source(path: Path) -> bool:
    relative_parts = path.relative_to(CLIENT_ROOT).parts
    return (
        any(part in {"__tests__", "tests"} for part in relative_parts)
        or ".test." in path.name
        or path.name.endswith("_test.py")
    )


def durable_tooling_source_candidates() -> set[Path]:
    candidates = {
        path
        for path in (CLIENT_ROOT / "scripts").rglob("*")
        if path.is_file()
        and path.suffix in TOOLING_EXTENSIONS
        and not is_test_source(path)
    }
    candidates.update(
        path
        for path in (CLIENT_ROOT / "config").rglob("*")
        if path.is_file()
        and path not in {ASSET_MANIFEST_PATH, ASSET_RIGHTS_PATH}
        and path.suffix in TOOLING_EXTENSIONS
    )
    candidates.update(
        path
        for path in CLIENT_ROOT.iterdir()
        if path.is_file()
        and path.suffix in TOOLING_EXTENSIONS
        and not is_test_source(path)
    )
    return candidates


RUNTIME_REFERENCE_SOURCES = tuple(
    sorted(
        path
        for path in (CLIENT_ROOT / "src").rglob("*")
        if path.is_file() and path.suffix in SOURCE_EXTENSIONS
    )
) + (CLIENT_ROOT / "index.html", GALLERY_ROOT / "manifest.json")
TOOLING_REFERENCE_SOURCES = tuple(sorted(durable_tooling_source_candidates()))
ALWAYS_REQUIRED_BY_PURPOSE = {
    "manifest.json": {"runtime"},
    "runtime-inputs/default-input-bindings.json": {"tooling"},
}
REFERENCE_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_./-])/?(?:public/)?template-gallery/([^\"'`\\\s,}\])]+)"
)
COMMIT_PATTERN = re.compile(r"^[a-f0-9]{40}$")
REPO_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")
IGNORED_NAMES = {".DS_Store", "Thumbs.db"}
BUFFER_SIZE = 1024 * 1024
WINDOWS_RESERVED_BASENAMES = {
    "aux",
    "clock$",
    "con",
    "nul",
    "prn",
    *(f"com{index}" for index in range(1, 10)),
    *(f"lpt{index}" for index in range(1, 10)),
}
WINDOWS_FORBIDDEN_PATH_CHARACTERS = re.compile(r'[<>:"|?*\x00-\x1f]')
PRESERVED_LOCAL_ASSET_PATHS = frozenset(
    {
        "manifest.json",
        "runtime-inputs/default-input-bindings.json",
    }
)


class AssetPipelineError(RuntimeError):
    """A user-actionable template asset pipeline failure."""


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(BUFFER_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def image_dimensions(path: Path, content_type: str) -> tuple[int, int] | None:
    if content_type not in {"image/png", "image/webp"}:
        return None
    data = path.read_bytes()
    if content_type == "image/png":
        if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
            raise AssetPipelineError(f"Invalid PNG Gallery asset: {path}")
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise AssetPipelineError(f"Invalid WebP Gallery asset: {path}")
    offset = 12
    while offset + 8 <= len(data):
        kind = data[offset : offset + 4]
        chunk_size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        chunk = data[offset + 8 : offset + 8 + chunk_size]
        if len(chunk) != chunk_size:
            break
        if kind == b"VP8X" and len(chunk) >= 10:
            return int.from_bytes(chunk[4:7], "little") + 1, int.from_bytes(
                chunk[7:10], "little"
            ) + 1
        if kind == b"VP8L" and len(chunk) >= 5 and chunk[0] == 0x2F:
            bits = int.from_bytes(chunk[1:5], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        if kind == b"VP8 " and len(chunk) >= 10 and chunk[3:6] == b"\x9d\x01\x2a":
            return int.from_bytes(chunk[6:8], "little") & 0x3FFF, int.from_bytes(
                chunk[8:10], "little"
            ) & 0x3FFF
        offset += 8 + chunk_size + (chunk_size % 2)
    raise AssetPipelineError(f"Could not read WebP dimensions: {path}")


def normalized_relative_path(value: str) -> str:
    normalized = value.replace("\\", "/").lstrip("/")
    if normalized.startswith("public/template-gallery/"):
        normalized = normalized.removeprefix("public/template-gallery/")
    elif normalized.startswith("template-gallery/"):
        normalized = normalized.removeprefix("template-gallery/")
    segments = [segment for segment in normalized.split("/") if segment]
    if not segments or any(segment in {".", ".."} for segment in segments):
        raise AssetPipelineError(f"Unsafe or empty Gallery asset path: {value}")
    return "/".join(segments)


def canonical_manifest_relative_path(value: str) -> str:
    """Validate a portable manifest path and return its Gallery-relative form."""

    prefix = "template-gallery/"
    if not isinstance(value, str) or not value.startswith(prefix):
        raise AssetPipelineError(
            f"Asset path is not in canonical template-gallery form: {value!r}"
        )
    relative_path = value.removeprefix(prefix)
    segments = relative_path.split("/")
    if not relative_path or any(segment in {"", ".", ".."} for segment in segments):
        raise AssetPipelineError(f"Unsafe or non-canonical asset path: {value}")
    for segment in segments:
        if "\\" in segment or WINDOWS_FORBIDDEN_PATH_CHARACTERS.search(segment):
            raise AssetPipelineError(
                f"Asset path is not portable across Linux and Windows: {value}"
            )
        if segment.endswith((" ", ".")):
            raise AssetPipelineError(
                f"Asset path is not portable across Linux and Windows: {value}"
            )
        if segment.split(".", 1)[0].casefold() in WINDOWS_RESERVED_BASENAMES:
            raise AssetPipelineError(
                f"Asset path uses a Windows-reserved name: {value}"
            )
    if value != f"{prefix}{'/'.join(segments)}":
        raise AssetPipelineError(f"Asset path is not canonical: {value}")
    return "/".join(segments)


def manifest_record_relative_path(record: dict[str, Any]) -> str:
    declared_path = record.get("path")
    if not isinstance(declared_path, str):
        raise AssetPipelineError("The asset manifest contains a non-string path.")
    return canonical_manifest_relative_path(declared_path)


def path_is_link_or_reparse_point(path: Path) -> bool:
    """Reject symlinks, junctions, and other Windows reparse-point redirects."""

    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return False
    except OSError as error:
        raise AssetPipelineError(f"Could not inspect path safely {path}: {error}") from error
    if stat.S_ISLNK(metadata.st_mode):
        return True
    file_attributes = getattr(metadata, "st_file_attributes", 0)
    reparse_attribute = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    if reparse_attribute and file_attributes & reparse_attribute:
        return True
    is_junction = getattr(path, "is_junction", None)
    try:
        return bool(callable(is_junction) and is_junction())
    except OSError as error:
        raise AssetPipelineError(f"Could not inspect path safely {path}: {error}") from error


def filesystem_identity(metadata: os.stat_result) -> tuple[int, int]:
    return metadata.st_dev, metadata.st_ino


def stable_file_identity(metadata: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def content_file_identity(metadata: os.stat_result) -> tuple[int, int, int, int]:
    """Compare path and handle views without Windows' inconsistent ctime view."""

    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_size,
        metadata.st_mtime_ns,
    )


def inspect_regular_file(path: Path, *, context: str) -> tuple[os.stat_result, str]:
    """Hash one regular file while detecting link swaps and in-place changes."""

    if path_is_link_or_reparse_point(path):
        raise AssetPipelineError(f"{context} must not be a link or reparse point: {path}")
    try:
        before = path.lstat()
    except FileNotFoundError:
        raise AssetPipelineError(f"{context} is missing: {path}") from None
    except OSError as error:
        raise AssetPipelineError(f"Could not inspect {context.lower()} {path}: {error}") from error
    if not stat.S_ISREG(before.st_mode):
        raise AssetPipelineError(f"{context} is not a regular file: {path}")

    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise AssetPipelineError(f"Could not open {context.lower()} safely {path}: {error}") from error
    digest = hashlib.sha256()
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or content_file_identity(opened) != content_file_identity(before)
        ):
            raise AssetPipelineError(
                f"{context} changed while it was being opened: {path}"
            )
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = -1
            while chunk := handle.read(BUFFER_SIZE):
                digest.update(chunk)
            after_read = os.fstat(handle.fileno())
    finally:
        if descriptor >= 0:
            os.close(descriptor)

    try:
        after = path.lstat()
    except FileNotFoundError:
        raise AssetPipelineError(f"{context} changed while it was being verified: {path}") from None
    if (
        path_is_link_or_reparse_point(path)
        or not stat.S_ISREG(after.st_mode)
        or stable_file_identity(before) != stable_file_identity(after)
        or stable_file_identity(opened) != stable_file_identity(after_read)
        or content_file_identity(after_read) != content_file_identity(after)
    ):
        raise AssetPipelineError(f"{context} changed while it was being verified: {path}")
    return after, f"sha256:bytes:{digest.hexdigest()}"


def concrete_references(source: Path) -> set[str]:
    if not source.is_file():
        raise AssetPipelineError(
            f"Required Gallery reference source is missing: {source}"
        )
    references: set[str] = set()
    text = source.read_text(encoding="utf-8")
    for match in REFERENCE_PATTERN.finditer(text):
        raw_path = match.group(1).rstrip(");]")
        if not raw_path or any(marker in raw_path for marker in ("${", "<", ">", "*")):
            continue
        relative_path = normalized_relative_path(raw_path)
        # Directory constants and synthetic test-like strings are contracts,
        # not concrete bytes. Every published Gallery file has an extension.
        if "." not in Path(relative_path).name:
            continue
        references.add(relative_path)
    return references


def required_assets_by_purpose() -> dict[str, set[str]]:
    unaudited = unaudited_durable_reference_sources()
    if unaudited:
        rendered = "\n  - ".join(
            str(path.relative_to(CLIENT_ROOT)) for path in unaudited
        )
        raise AssetPipelineError(
            f"Durable Gallery reference sources are not classified:\n  - {rendered}"
        )
    required = {
        path: set(purposes) for path, purposes in ALWAYS_REQUIRED_BY_PURPOSE.items()
    }
    for purpose, sources in (
        ("runtime", RUNTIME_REFERENCE_SOURCES),
        ("tooling", TOOLING_REFERENCE_SOURCES),
    ):
        for source in sources:
            for relative_path in concrete_references(source):
                required.setdefault(relative_path, set()).add(purpose)
    return required


def required_asset_paths() -> set[str]:
    return set(required_assets_by_purpose())


def audited_reference_sources() -> tuple[Path, ...]:
    return tuple(
        dict.fromkeys((*RUNTIME_REFERENCE_SOURCES, *TOOLING_REFERENCE_SOURCES))
    )


def unaudited_durable_reference_sources() -> list[Path]:
    """Return durable source/config/script files the classifier failed to scan."""

    audited = set(audited_reference_sources())
    candidates = {
        path
        for path in (CLIENT_ROOT / "src").rglob("*")
        if path.is_file() and path.suffix in (SOURCE_EXTENSIONS | TOOLING_EXTENSIONS)
    }
    candidates.update(durable_tooling_source_candidates())
    candidates.add(CLIENT_ROOT / "index.html")
    candidates.add(GALLERY_ROOT / "manifest.json")
    return sorted(
        path
        for path in candidates - audited
        if path.is_file() and concrete_references(path)
    )


def local_asset_paths() -> set[str]:
    if not GALLERY_ROOT.is_dir():
        return set()
    assets: set[str] = set()
    for path in GALLERY_ROOT.rglob("*"):
        if path_is_link_or_reparse_point(path):
            raise AssetPipelineError(
                f"Gallery assets and directories must not be links or reparse points: {path}"
            )
        if not path.is_file() or path.name in IGNORED_NAMES or ".cache" in path.parts:
            continue
        assets.add(path.relative_to(GALLERY_ROOT).as_posix())
    return assets


def asset_record(relative_path: str, purposes: set[str]) -> dict[str, Any]:
    path = GALLERY_ROOT / relative_path
    content_type, _ = mimetypes.guess_type(relative_path)
    normalized_content_type = content_type or "application/octet-stream"
    record = {
        "path": f"template-gallery/{relative_path}",
        "size": path.stat().st_size,
        "sha256": f"sha256:bytes:{sha256_file(path)}",
        "contentType": normalized_content_type,
        "purposes": sorted(purposes),
    }
    dimensions = image_dimensions(path, normalized_content_type)
    if dimensions:
        record.update({"width": dimensions[0], "height": dimensions[1]})
    return record


def build_manifest(asset_version: str = "v1") -> tuple[dict[str, Any], list[str]]:
    required_by_purpose = required_assets_by_purpose()
    required = set(required_by_purpose)
    local = local_asset_paths()
    missing = sorted(required - local)
    records = [
        asset_record(path, required_by_purpose[path])
        for path in sorted(required & local)
    ]
    identity_payload = {
        "schemaVersion": 1,
        "assetVersion": asset_version,
        "assets": records,
    }
    manifest = {
        **identity_payload,
        "assetSetId": f"sha256:canonical-json:{sha256_bytes(canonical_json_bytes(identity_payload))}",
        "status": "ready" if not missing else "blocked",
        "assetCount": len(records),
        "totalBytes": sum(record["size"] for record in records),
        "missingAssets": [f"template-gallery/{path}" for path in missing],
    }
    return manifest, missing


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(payload, encoding="utf-8", newline="\n")
    temporary.replace(path)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AssetPipelineError(
            f"Could not read valid JSON from {path}: {error}"
        ) from error


def checked_manifest() -> dict[str, Any]:
    value = read_json(ASSET_MANIFEST_PATH)
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise AssetPipelineError(f"Invalid asset manifest: {ASSET_MANIFEST_PATH}")
    return value


def build_rights_template(manifest: dict[str, Any]) -> dict[str, Any]:
    """Build a fail-closed ledger while preserving records for unchanged bytes."""

    existing_records: dict[str, dict[str, Any]] = {}
    if ASSET_RIGHTS_PATH.is_file():
        existing = read_json(ASSET_RIGHTS_PATH)
        if isinstance(existing, dict) and isinstance(existing.get("records"), list):
            existing_records = {
                record.get("path"): record
                for record in existing["records"]
                if isinstance(record, dict) and isinstance(record.get("path"), str)
            }
    records: list[dict[str, Any]] = []
    for asset in manifest["assets"]:
        prior = existing_records.get(asset["path"])
        if isinstance(prior, dict) and prior.get("sha256") == asset["sha256"]:
            records.append(prior)
            continue
        records.append(
            {
                "path": asset["path"],
                "sha256": asset["sha256"],
                "publishDecision": "hold",
                "holdReason": "Complete and independently review the redistribution-rights record for these exact bytes.",
                "creatorOrRightsholder": None,
                "creationMethod": None,
                "sourceUrl": None,
                "sourceRevision": None,
                "sourceLicense": None,
                "modelTerms": [],
                "aiGenerated": None,
                "humanLikenessConsent": None,
                "marks": [],
                "requiredAttribution": [],
                "assetLicense": None,
                "reviewedBy": None,
                "reviewedAt": None,
            }
        )
    return {
        "schemaVersion": 1,
        "assetSetId": manifest["assetSetId"],
        "records": records,
    }


def validate_asset_rights(
    manifest: dict[str, Any], *, allow_held: bool = False
) -> dict[str, Any]:
    """Require one approved, human-reviewed rights record for every exact byte."""

    if not ASSET_RIGHTS_PATH.is_file():
        raise AssetPipelineError(
            "The per-asset rights ledger is missing. Run `python scripts/template-gallery-assets.py rights-template --write`, complete every record, and obtain a human rights review."
        )
    ledger = read_json(ASSET_RIGHTS_PATH)
    if not isinstance(ledger, dict) or ledger.get("schemaVersion") != 1:
        raise AssetPipelineError(
            "The per-asset rights ledger must use schemaVersion 1."
        )
    if ledger.get("assetSetId") != manifest.get("assetSetId"):
        raise AssetPipelineError(
            "The per-asset rights ledger is stale for the current asset-set identity."
        )
    records = ledger.get("records")
    if not isinstance(records, list):
        raise AssetPipelineError(
            "The per-asset rights ledger must contain a records array."
        )
    expected = {record["path"]: record["sha256"] for record in manifest["assets"]}
    actual: dict[str, dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("path"), str):
            raise AssetPipelineError(
                "The per-asset rights ledger contains an invalid record."
            )
        path = record["path"]
        if path in actual:
            raise AssetPipelineError(f"Duplicate rights record: {path}")
        actual[path] = record
    if set(actual) != set(expected):
        missing = sorted(set(expected) - set(actual))
        unexpected = sorted(set(actual) - set(expected))
        details = [
            *(f"missing {path}" for path in missing),
            *(f"unexpected {path}" for path in unexpected),
        ]
        raise AssetPipelineError(
            "The per-asset rights ledger does not exactly cover the asset manifest:\n  - "
            + "\n  - ".join(details)
        )
    held: list[str] = []
    consent_values = {"not-applicable", "synthetic", "documented-consent"}
    for path in sorted(expected):
        record = actual[path]
        if record.get("sha256") != expected[path]:
            raise AssetPipelineError(
                f"Rights record hash does not match the asset manifest: {path}"
            )
        if record.get("publishDecision") != "approved":
            if (
                not isinstance(record.get("holdReason"), str)
                or not record["holdReason"].strip()
            ):
                raise AssetPipelineError(
                    f"Held rights record must explain the hold: {path}"
                )
            held.append(path)
            continue
        required_strings = (
            "creatorOrRightsholder",
            "creationMethod",
            "sourceLicense",
            "assetLicense",
            "reviewedBy",
            "reviewedAt",
        )
        if any(
            not isinstance(record.get(field), str) or not record[field].strip()
            for field in required_strings
        ):
            raise AssetPipelineError(
                f"Approved rights record has an empty required field: {path}"
            )
        if record["reviewedBy"].strip().casefold() in {
            "your full name",
            "your name",
            "todo",
            "tbd",
        }:
            raise AssetPipelineError(
                f"Approved rights record still uses a placeholder reviewer: {path}"
            )
        for nullable_field in ("sourceUrl", "sourceRevision"):
            if record.get(nullable_field) is not None and not isinstance(
                record[nullable_field], str
            ):
                raise AssetPipelineError(
                    f"Approved rights record has an invalid {nullable_field}: {path}"
                )
            if (
                isinstance(record.get(nullable_field), str)
                and not record[nullable_field].strip()
            ):
                raise AssetPipelineError(
                    f"Approved rights record has an empty {nullable_field}: {path}"
                )
        if isinstance(record.get("sourceUrl"), str) and not re.fullmatch(
            r"https?://[^\s]+", record["sourceUrl"]
        ):
            raise AssetPipelineError(
                f"Approved rights record has a non-HTTP sourceUrl: {path}"
            )
        for list_field in ("modelTerms", "marks", "requiredAttribution"):
            values = record.get(list_field)
            if not isinstance(values, list) or any(
                not isinstance(value, str) or not value.strip() for value in values
            ):
                raise AssetPipelineError(
                    f"Approved rights record has an invalid {list_field}: {path}"
                )
        if not isinstance(record.get("aiGenerated"), bool):
            raise AssetPipelineError(
                f"Approved rights record must declare aiGenerated: {path}"
            )
        if record["aiGenerated"] and not record["modelTerms"]:
            raise AssetPipelineError(
                f"AI-generated asset rights record must list modelTerms: {path}"
            )
        if record.get("humanLikenessConsent") not in consent_values:
            raise AssetPipelineError(
                f"Approved rights record has an invalid humanLikenessConsent: {path}"
            )
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", record["reviewedAt"]):
            raise AssetPipelineError(
                f"Approved rights record reviewedAt must use YYYY-MM-DD: {path}"
            )
    if held and not allow_held:
        rendered = "\n  - ".join(held)
        raise AssetPipelineError(
            f"The per-asset rights ledger still holds {len(held)} file(s):\n  - {rendered}"
        )
    return ledger


def validate_checked_manifest_contract() -> dict[str, Any]:
    manifest = checked_manifest()
    records = manifest.get("assets")
    missing_assets = manifest.get("missingAssets")
    if not isinstance(manifest.get("assetVersion"), str) or not manifest[
        "assetVersion"
    ].strip():
        raise AssetPipelineError("The asset manifest must declare an assetVersion.")
    if not isinstance(records, list) or not isinstance(missing_assets, list):
        raise AssetPipelineError(
            "The asset manifest must contain assets and missingAssets arrays."
        )
    paths: list[str] = []
    for record in records:
        if not isinstance(record, dict):
            raise AssetPipelineError("The asset manifest contains a non-object record.")
        path = record.get("path")
        purposes = record.get("purposes")
        if (
            not isinstance(path, str)
            or not isinstance(record.get("size"), int)
            or isinstance(record.get("size"), bool)
            or record["size"] < 0
            or not isinstance(record.get("sha256"), str)
            or not re.fullmatch(r"sha256:bytes:[a-f0-9]{64}", record["sha256"])
            or not isinstance(record.get("contentType"), str)
            or not record["contentType"].strip()
            or not isinstance(purposes, list)
            or not purposes
            or any(purpose not in {"runtime", "tooling"} for purpose in purposes)
            or purposes != sorted(set(purposes))
        ):
            raise AssetPipelineError(f"Invalid asset manifest record: {record!r}")
        canonical_manifest_relative_path(path)
        paths.append(path)
    if paths != sorted(set(paths)):
        raise AssetPipelineError("Asset manifest paths must be unique and sorted.")
    portable_paths = [path.casefold() for path in paths]
    if len(portable_paths) != len(set(portable_paths)):
        raise AssetPipelineError(
            "Asset manifest paths must remain unique on case-insensitive filesystems."
        )
    if any(not isinstance(path, str) for path in missing_assets):
        raise AssetPipelineError("Asset manifest missingAssets paths must be strings.")
    for path in missing_assets:
        canonical_manifest_relative_path(path)
    if missing_assets != sorted(set(missing_assets)):
        raise AssetPipelineError(
            "Asset manifest missingAssets paths must be unique and sorted."
        )
    if set(paths) & set(missing_assets):
        raise AssetPipelineError(
            "Asset manifest paths cannot be both present and missing."
        )
    all_portable_paths = [path.casefold() for path in (*paths, *missing_assets)]
    if len(all_portable_paths) != len(set(all_portable_paths)):
        raise AssetPipelineError(
            "Asset manifest paths must remain unique on case-insensitive filesystems."
        )
    if manifest.get("assetCount") != len(records) or manifest.get("totalBytes") != sum(
        record["size"] for record in records
    ):
        raise AssetPipelineError("Asset manifest counts do not match its records.")
    identity_payload = {
        "schemaVersion": manifest.get("schemaVersion"),
        "assetVersion": manifest.get("assetVersion"),
        "assets": records,
    }
    expected_identity = (
        f"sha256:canonical-json:{sha256_bytes(canonical_json_bytes(identity_payload))}"
    )
    if manifest.get("assetSetId") != expected_identity:
        raise AssetPipelineError(
            "Asset manifest identity does not match its canonical records."
        )
    expected_required = {f"template-gallery/{path}" for path in required_asset_paths()}
    declared_required = set(paths) | set(missing_assets)
    if declared_required != expected_required:
        raise AssetPipelineError(
            "Asset manifest does not classify every durable runtime/tooling reference."
        )
    expected_status = "blocked" if missing_assets else "ready"
    if manifest.get("status") != expected_status:
        raise AssetPipelineError(f"Asset manifest status must be {expected_status}.")
    return manifest


def verify_checked_manifest(*, require_ready: bool = True) -> dict[str, Any]:
    expected = validate_checked_manifest_contract()
    actual, missing = build_manifest(str(expected.get("assetVersion", "v1")))
    if canonical_json_bytes(actual) != canonical_json_bytes(expected):
        raise AssetPipelineError(
            "The checked-in asset manifest is stale. Run "
            "`python scripts/template-gallery-assets.py inventory --write`."
        )
    if require_ready and missing:
        rendered = "\n  - ".join(missing)
        raise AssetPipelineError(
            f"The Gallery asset set is incomplete:\n  - {rendered}"
        )
    return actual


def format_bytes(size: int) -> str:
    value = float(size)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if value < 1024 or unit == "TiB":
            return f"{value:.2f} {unit}"
        value /= 1024
    return f"{size} B"


def print_inventory(manifest: dict[str, Any]) -> None:
    required_by_purpose = required_assets_by_purpose()
    required = set(required_by_purpose)
    local = local_asset_paths()
    unreferenced = sorted(local - required)
    print(f"Status: {manifest['status']}")
    runtime_count = sum(
        "runtime" in purposes for purposes in required_by_purpose.values()
    )
    tooling_only_count = sum(
        purposes == {"tooling"} for purposes in required_by_purpose.values()
    )
    print(f"Required assets: {len(required)}")
    print(
        f"Present required assets: {manifest['assetCount']} ({format_bytes(manifest['totalBytes'])})"
    )
    print(f"  Runtime referenced: {runtime_count}")
    print(f"  Tooling-only: {tooling_only_count}")
    print(f"Missing required assets: {len(manifest['missingAssets'])}")
    for path in manifest["missingAssets"]:
        print(f"  MISSING {path}")
    print(f"Unreferenced migration candidates: {len(unreferenced)}")
    for path in unreferenced:
        size = (GALLERY_ROOT / path).stat().st_size
        print(f"  REVIEW template-gallery/{path} ({format_bytes(size)})")
    print(f"Asset set: {manifest['assetSetId']}")


def require_hub():
    try:
        import hf_xet  # noqa: F401
        from huggingface_hub import HfApi, hf_hub_download, snapshot_download
    except ImportError as error:
        raise AssetPipelineError(
            "Hub commands require huggingface_hub with hf_xet. Run them with MoDiff's managed Python environment."
        ) from error
    return HfApi, hf_hub_download, snapshot_download


def validate_repo_id(repo_id: str) -> None:
    if not REPO_ID_PATTERN.fullmatch(repo_id):
        raise AssetPipelineError("Dataset repo ID must be `namespace/name`.")


def validate_revision(revision: str) -> None:
    if not COMMIT_PATTERN.fullmatch(revision):
        raise AssetPipelineError(
            "Dataset revision must be an immutable 40-character commit SHA, not a branch or tag."
        )


def dataset_card_metadata() -> dict[str, str]:
    """Read the small YAML front matter without adding a YAML dependency."""

    if not DATASET_CARD_PATH.is_file():
        raise AssetPipelineError(
            f"Dataset card template is missing: {DATASET_CARD_PATH}"
        )
    lines = DATASET_CARD_PATH.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        raise AssetPipelineError("Dataset card must start with YAML front matter.")
    metadata: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if line.startswith((" ", "\t")) or ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip().strip("'\"")
    else:
        raise AssetPipelineError("Dataset card YAML front matter is not closed.")
    return metadata


def validate_dataset_licensing() -> None:
    """Require explicit, publishable terms before any external Hub mutation."""

    metadata = dataset_card_metadata()
    license_id = metadata.get("license", "").strip()
    if not license_id:
        raise AssetPipelineError(
            "Dataset card must declare a license before publication."
        )
    if license_id == "other":
        license_name = metadata.get("license_name", "").strip()
        if not license_name:
            raise AssetPipelineError(
                "Dataset card uses `license: other`; Hugging Face requires `license_name` and a Dataset LICENSE file."
            )
        if (
            not DATASET_LICENSE_PATH.is_file()
            or not DATASET_LICENSE_PATH.read_text(encoding="utf-8").strip()
        ):
            raise AssetPipelineError(
                "Dataset card uses `license: other`, but docs/template-gallery-dataset-license.txt is missing or empty."
            )


def copy_asset_bytes(source: Path, destination: Path) -> None:
    """Copy bytes without sharing an inode with mutable sources or Hub caches."""

    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def stage_upload(manifest: dict[str, Any], destination: Path) -> None:
    validate_dataset_licensing()
    validate_asset_rights(manifest)
    for record in manifest["assets"]:
        repository_path = manifest_record_relative_path(record)
        copy_asset_bytes(
            GALLERY_ROOT / repository_path,
            destination / "template-gallery" / repository_path,
        )
    manifest_destination = destination / "_modiff" / "template-assets.v1.json"
    manifest_destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ASSET_MANIFEST_PATH, manifest_destination)
    shutil.copy2(
        ASSET_RIGHTS_PATH,
        destination / "_modiff" / "template-asset-rights.v1.json",
    )
    shutil.copy2(DATASET_CARD_PATH, destination / "README.md")
    if DATASET_LICENSE_PATH.is_file():
        shutil.copy2(DATASET_LICENSE_PATH, destination / "LICENSE")
    # These are independent copies, not hardlinks to a mutable checkout. Hash
    # them again after every copy so an edit racing the staging pass cannot be
    # published under the checked manifest's identity.
    verify_materialized_assets(destination, manifest, reject_unexpected=True)


def build_provisional_publication(
    manifest: dict[str, Any], ledger: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """Project one complete local set into an explicitly incomplete publication."""

    decisions = {
        record["path"]: record.get("publishDecision")
        for record in ledger["records"]
    }
    approved_assets = [
        record
        for record in manifest["assets"]
        if decisions.get(record["path"]) == "approved"
    ]
    held_paths = sorted(
        record["path"]
        for record in manifest["assets"]
        if decisions.get(record["path"]) != "approved"
    )
    if not held_paths:
        raise AssetPipelineError(
            "The rights ledger has no held files; use the complete `upload` command."
        )
    if not approved_assets:
        raise AssetPipelineError("No rights-approved files are available to publish.")

    identity_payload = {
        "schemaVersion": 1,
        "assetVersion": manifest["assetVersion"],
        "assets": approved_assets,
    }
    provisional_manifest = {
        **identity_payload,
        "assetSetId": "sha256:canonical-json:"
        + sha256_bytes(canonical_json_bytes(identity_payload)),
        "status": "blocked",
        "assetCount": len(approved_assets),
        "totalBytes": sum(record["size"] for record in approved_assets),
        "missingAssets": sorted(
            set(manifest.get("missingAssets", [])) | set(held_paths)
        ),
        "publicationKind": "provisional-rights-approved-subset",
        "completeAssetSetId": manifest["assetSetId"],
    }
    approved_paths = {record["path"] for record in approved_assets}
    provisional_ledger = {
        "schemaVersion": 1,
        "assetSetId": provisional_manifest["assetSetId"],
        "publicationKind": "provisional-rights-approved-subset",
        "records": [
            record for record in ledger["records"] if record["path"] in approved_paths
        ],
    }
    return provisional_manifest, provisional_ledger, held_paths


def provisional_dataset_card(held_paths: list[str]) -> str:
    held_list = "\n".join(f"- `{path}`" for path in held_paths)
    return (
        DATASET_CARD_PATH.read_text(encoding="utf-8").rstrip()
        + "\n\n## Provisional publication\n\n"
        + "This revision contains only the rights-approved subset and is intentionally "
        + "incomplete. It must not be activated as MoDiff's runtime Dataset. The complete "
        + "local asset set remains authoritative until the pending permissions are resolved.\n\n"
        + "Files withheld from this revision:\n\n"
        + held_list
        + "\n"
    )


def stage_provisional_upload(
    manifest: dict[str, Any], destination: Path
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    validate_dataset_licensing()
    ledger = validate_asset_rights(manifest, allow_held=True)
    provisional_manifest, provisional_ledger, held_paths = (
        build_provisional_publication(manifest, ledger)
    )
    approved_paths = {
        record["path"] for record in provisional_manifest["assets"]
    }
    for record in manifest["assets"]:
        if record["path"] not in approved_paths:
            continue
        repository_path = manifest_record_relative_path(record)
        copy_asset_bytes(
            GALLERY_ROOT / repository_path,
            destination / "template-gallery" / repository_path,
        )
    write_json(
        destination / "_modiff" / "template-assets.v1.json",
        provisional_manifest,
    )
    write_json(
        destination / "_modiff" / "template-asset-rights.v1.json",
        provisional_ledger,
    )
    (destination / "README.md").write_text(
        provisional_dataset_card(held_paths), encoding="utf-8", newline="\n"
    )
    if DATASET_LICENSE_PATH.is_file():
        shutil.copy2(DATASET_LICENSE_PATH, destination / "LICENSE")
    verify_materialized_assets(
        destination, provisional_manifest, reject_unexpected=True
    )
    return provisional_manifest, provisional_ledger, held_paths


def ensure_public_repo(
    api: Any, repo_id: str, *, create: bool, make_public: bool
) -> None:
    from huggingface_hub.errors import RepositoryNotFoundError

    try:
        info = api.repo_info(repo_id=repo_id, repo_type="dataset")
    except RepositoryNotFoundError:
        if not create:
            raise AssetPipelineError(
                f"Dataset {repo_id} does not exist. Re-run with --create after confirming the namespace."
            ) from None
        api.create_repo(
            repo_id=repo_id, repo_type="dataset", private=False, exist_ok=False
        )
        info = api.repo_info(repo_id=repo_id, repo_type="dataset")
    if getattr(info, "private", False):
        if not make_public:
            raise AssetPipelineError(
                f"Dataset {repo_id} is private. Re-run with --make-public only if public access is intended."
            )
        api.update_repo_settings(repo_id=repo_id, repo_type="dataset", private=False)
        info = api.repo_info(repo_id=repo_id, repo_type="dataset")
    if getattr(info, "private", False):
        raise AssetPipelineError(
            f"Dataset {repo_id} is still private; refusing activation."
        )


def remote_manifest(
    repo_id: str, revision: str, *, token: bool | str | None = None
) -> dict[str, Any]:
    _, hf_hub_download, _ = require_hub()
    path = hf_hub_download(
        repo_id=repo_id,
        repo_type="dataset",
        revision=revision,
        filename="_modiff/template-assets.v1.json",
        token=token,
    )
    value = read_json(Path(path))
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise AssetPipelineError("The remote Dataset asset manifest is invalid.")
    return value


def remote_rights_ledger(
    repo_id: str, revision: str, *, token: bool | str | None = None
) -> dict[str, Any]:
    _, hf_hub_download, _ = require_hub()
    path = hf_hub_download(
        repo_id=repo_id,
        repo_type="dataset",
        revision=revision,
        filename="_modiff/template-asset-rights.v1.json",
        token=token,
    )
    value = read_json(Path(path))
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise AssetPipelineError("The remote Dataset rights ledger is invalid.")
    return value


def assert_remote_manifest_matches(repo_id: str, revision: str) -> dict[str, Any]:
    validate_repo_id(repo_id)
    validate_revision(revision)
    # Validate all paths before downloading or materializing anything. Equality
    # then makes the remotely supplied contract safe to use for local joins.
    local = validate_checked_manifest_contract()
    remote = remote_manifest(repo_id, revision, token=False)
    remote_rights = remote_rights_ledger(repo_id, revision, token=False)
    if canonical_json_bytes(local) == canonical_json_bytes(remote):
        local_rights = validate_asset_rights(local)
        if canonical_json_bytes(local_rights) != canonical_json_bytes(remote_rights):
            raise AssetPipelineError(
                "The pinned Dataset rights ledger does not match the checked-in rights ledger."
            )
        return remote

    # An immutable rights-approved subset can be installed before the remaining
    # preview permissions arrive. It is bound both to the complete authoring set
    # and to the exact missing paths in the checked-in source configuration.
    source = read_json(SOURCE_CONFIG_PATH)
    unavailable = source.get("unavailableAssets") if isinstance(source, dict) else None
    if (
        not isinstance(source, dict)
        or source.get("mode") != "huggingface"
        or source.get("repoId") != repo_id
        or source.get("revision") != revision
        or source.get("assetSetId") != remote.get("assetSetId")
        or source.get("completeAssetSetId") != local.get("assetSetId")
        or not isinstance(unavailable, list)
        or unavailable != sorted(set(unavailable))
        or remote.get("publicationKind") != "provisional-rights-approved-subset"
        or remote.get("completeAssetSetId") != local.get("assetSetId")
        or remote.get("status") != "blocked"
        or remote.get("missingAssets") != unavailable
        or remote.get("assetVersion") != local.get("assetVersion")
    ):
        raise AssetPipelineError(
            "The pinned Dataset manifest does not match the checked-in asset manifest or approved-subset source."
        )

    local_records = {record["path"]: record for record in local["assets"]}
    remote_records = remote.get("assets")
    if not isinstance(remote_records, list):
        raise AssetPipelineError("The approved-subset Dataset has no valid asset records.")
    remote_paths = [record.get("path") for record in remote_records if isinstance(record, dict)]
    expected_paths = sorted(set(local_records) - set(unavailable))
    identity_payload = {
        "schemaVersion": 1,
        "assetVersion": local["assetVersion"],
        "assets": remote_records,
    }
    expected_remote_identity = (
        "sha256:canonical-json:"
        + sha256_bytes(canonical_json_bytes(identity_payload))
    )
    if (
        len(remote_paths) != len(remote_records)
        or remote_paths != expected_paths
        or any(
            canonical_json_bytes(record) != canonical_json_bytes(local_records[record["path"]])
            for record in remote_records
        )
        or remote.get("assetSetId") != expected_remote_identity
        or remote.get("assetCount") != len(remote_records)
        or remote.get("totalBytes") != sum(record["size"] for record in remote_records)
    ):
        raise AssetPipelineError(
            "The approved-subset Dataset is not an exact projection of the checked-in asset manifest."
        )

    local_rights = validate_asset_rights(local, allow_held=True)
    local_rights_by_path = {
        record["path"]: record for record in local_rights["records"]
    }
    expected_remote_rights = {
        "schemaVersion": 1,
        "assetSetId": remote["assetSetId"],
        "publicationKind": "provisional-rights-approved-subset",
        "records": [local_rights_by_path[path] for path in expected_paths],
    }
    if canonical_json_bytes(remote_rights) != canonical_json_bytes(expected_remote_rights):
        raise AssetPipelineError(
            "The pinned Dataset rights ledger does not match the checked-in approved records."
        )
    return remote


def verify_public_remote_snapshot(
    repo_id: str, revision: str, manifest: dict[str, Any]
) -> Path:
    """Verify the activated public Dataset and every managed byte anonymously."""

    remote = assert_remote_manifest_matches(repo_id, revision)
    if canonical_json_bytes(remote) != canonical_json_bytes(manifest):
        raise AssetPipelineError(
            "The activated Dataset does not match the validated checked-in asset manifest."
        )
    HfApi, _, snapshot_download = require_hub()
    info = HfApi(token=False).repo_info(
        repo_id=repo_id,
        repo_type="dataset",
        revision=revision,
        token=False,
    )
    if getattr(info, "private", False):
        raise AssetPipelineError(
            "The activated Dataset is private; refusing to remove the local public fallback."
        )
    snapshot = Path(
        snapshot_download(
            repo_id=repo_id,
            repo_type="dataset",
            revision=revision,
            token=False,
            allow_patterns=["template-gallery/**", "_modiff/**"],
        )
    )
    verify_materialized_assets(snapshot, manifest, reject_unexpected=True)
    return snapshot


def verify_public_provisional_snapshot(
    repo_id: str,
    revision: str,
    manifest: dict[str, Any],
    ledger: dict[str, Any],
) -> Path:
    """Verify an incomplete, non-activatable Dataset publication anonymously."""

    validate_repo_id(repo_id)
    validate_revision(revision)
    remote = remote_manifest(repo_id, revision, token=False)
    if canonical_json_bytes(remote) != canonical_json_bytes(manifest):
        raise AssetPipelineError(
            "The provisional Dataset manifest differs from the staged manifest."
        )
    remote_ledger = remote_rights_ledger(repo_id, revision, token=False)
    if canonical_json_bytes(remote_ledger) != canonical_json_bytes(ledger):
        raise AssetPipelineError(
            "The provisional Dataset rights ledger differs from the staged ledger."
        )
    HfApi, _, snapshot_download = require_hub()
    info = HfApi(token=False).repo_info(
        repo_id=repo_id,
        repo_type="dataset",
        revision=revision,
        token=False,
    )
    if getattr(info, "private", False):
        raise AssetPipelineError("The provisional Dataset is not publicly readable.")
    snapshot = Path(
        snapshot_download(
            repo_id=repo_id,
            repo_type="dataset",
            revision=revision,
            token=False,
            allow_patterns=["template-gallery/**", "_modiff/**"],
        )
    )
    verify_materialized_assets(snapshot, manifest, reject_unexpected=True)
    return snapshot


def activated_remote_source(manifest: dict[str, Any]) -> tuple[str, str]:
    source = read_json(SOURCE_CONFIG_PATH)
    if not isinstance(source, dict) or source.get("mode") != "huggingface":
        raise AssetPipelineError(
            "Local pruning requires checked-in templateAssetSource.json mode `huggingface`."
        )
    repo_id = source.get("repoId")
    revision = source.get("revision")
    if not isinstance(repo_id, str) or not isinstance(revision, str):
        raise AssetPipelineError(
            "The activated Dataset source must declare repoId and revision."
        )
    validate_repo_id(repo_id)
    validate_revision(revision)
    if source.get("assetSetId") != manifest.get("assetSetId"):
        raise AssetPipelineError(
            "The activated Dataset assetSetId does not match config/template-assets.v1.json."
        )
    return repo_id, revision


def assert_local_gallery_root_is_safe() -> None:
    try:
        relative_root = GALLERY_ROOT.relative_to(CLIENT_ROOT)
    except ValueError as error:
        raise AssetPipelineError(
            f"Gallery root must remain inside the client repository: {GALLERY_ROOT}"
        ) from error
    if not relative_root.parts:
        raise AssetPipelineError("Gallery root must not be the client repository root.")
    current = CLIENT_ROOT
    for segment in relative_root.parts:
        current /= segment
        if path_is_link_or_reparse_point(current):
            raise AssetPipelineError(
                "The local Gallery tree must not contain links or reparse points: "
                f"{current}"
            )


def local_prune_targets(
    manifest: dict[str, Any],
) -> list[tuple[Path, dict[str, Any]]]:
    """Preflight exact manifest paths without following local symlinks."""

    assert_local_gallery_root_is_safe()
    if GALLERY_ROOT.exists() and not GALLERY_ROOT.is_dir():
        raise AssetPipelineError(f"Gallery root must be a directory: {GALLERY_ROOT}")

    targets: list[tuple[Path, dict[str, Any]]] = []
    for record in manifest["assets"]:
        relative_path = manifest_record_relative_path(record)

        target = GALLERY_ROOT.joinpath(*relative_path.split("/"))
        ancestor = GALLERY_ROOT
        for segment in relative_path.split("/")[:-1]:
            ancestor /= segment
            if path_is_link_or_reparse_point(ancestor):
                raise AssetPipelineError(
                    "Gallery asset ancestors must not be links or reparse points: "
                    f"{ancestor}"
                )
            if ancestor.exists() and not ancestor.is_dir():
                raise AssetPipelineError(
                    f"Gallery asset ancestor is not a directory: {ancestor}"
                )
        if path_is_link_or_reparse_point(target):
            raise AssetPipelineError(
                "Gallery assets selected for pruning must not be links or reparse "
                f"points: {target}"
            )
        if relative_path in PRESERVED_LOCAL_ASSET_PATHS:
            continue
        try:
            target_metadata = target.lstat()
        except FileNotFoundError:
            target_metadata = None
        if target_metadata is not None:
            if not stat.S_ISREG(target_metadata.st_mode):
                raise AssetPipelineError(
                    f"Gallery asset selected for pruning is not a regular file: {target}"
                )
            verified_metadata, actual_sha256 = inspect_regular_file(
                target, context="Gallery asset selected for pruning"
            )
            if verified_metadata.st_size != record["size"]:
                raise AssetPipelineError(
                    f"Refusing to prune a locally modified Gallery asset (size mismatch): {target}"
                )
            if actual_sha256 != record["sha256"]:
                raise AssetPipelineError(
                    f"Refusing to prune a locally modified Gallery asset (hash mismatch): {target}"
                )
        targets.append((target, record))
    return targets


def prune_exact_local_assets(
    targets: list[tuple[Path, dict[str, Any]]],
) -> tuple[int, int, int]:
    """Unlink preflighted files and remove only their newly empty ancestors."""

    deleted_count = 0
    deleted_bytes = 0
    absent_count = 0
    candidate_directories: set[Path] = set()
    for target, record in targets:
        assert_local_gallery_root_is_safe()
        try:
            target.relative_to(GALLERY_ROOT)
        except ValueError as error:
            raise AssetPipelineError(
                f"Prune target escaped the local Gallery root: {target}"
            ) from error
        ancestor = target.parent
        while ancestor != GALLERY_ROOT:
            if path_is_link_or_reparse_point(ancestor):
                raise AssetPipelineError(
                    "Gallery asset ancestor changed to a link or reparse point during "
                    f"pruning: {ancestor}"
                )
            ancestor = ancestor.parent
        if path_is_link_or_reparse_point(target):
            raise AssetPipelineError(
                f"Gallery asset changed after preflight; refusing to continue: {target}"
            )
        try:
            target.lstat()
        except FileNotFoundError:
            absent_count += 1
            continue
        current_metadata, current_sha256 = inspect_regular_file(
            target, context="Gallery asset changed after preflight"
        )
        if current_metadata.st_size != record["size"]:
            raise AssetPipelineError(
                f"Gallery asset changed after preflight (size mismatch): {target}"
            )
        if current_sha256 != record["sha256"]:
            raise AssetPipelineError(
                f"Gallery asset changed after preflight (hash mismatch): {target}"
            )
        # Recheck the directory chain and exact entry identity immediately
        # before unlink. This closes ordinary mutation/junction races; see the
        # handoff note for the final platform-level rename window.
        ancestor = target.parent
        while ancestor != GALLERY_ROOT:
            if path_is_link_or_reparse_point(ancestor):
                raise AssetPipelineError(
                    "Gallery asset ancestor changed to a link or reparse point during "
                    f"pruning: {ancestor}"
                )
            ancestor = ancestor.parent
        try:
            latest_metadata = target.lstat()
        except FileNotFoundError:
            raise AssetPipelineError(
                f"Gallery asset changed immediately before unlink: {target}"
            ) from None
        if (
            path_is_link_or_reparse_point(target)
            or stable_file_identity(latest_metadata)
            != stable_file_identity(current_metadata)
        ):
            raise AssetPipelineError(
                f"Gallery asset changed immediately before unlink: {target}"
            )
        target.unlink()
        deleted_count += 1
        deleted_bytes += int(record["size"])
        parent = target.parent
        while parent != GALLERY_ROOT:
            candidate_directories.add(parent)
            parent = parent.parent

    for directory in sorted(
        candidate_directories,
        key=lambda path: len(path.relative_to(GALLERY_ROOT).parts),
        reverse=True,
    ):
        if path_is_link_or_reparse_point(directory):
            raise AssetPipelineError(
                "Gallery directory changed to a link or reparse point during pruning: "
                f"{directory}"
            )
        try:
            directory.rmdir()
        except FileNotFoundError:
            continue
        except OSError as error:
            if error.errno not in {errno.ENOTEMPTY, errno.EEXIST}:
                raise AssetPipelineError(
                    f"Could not remove empty Gallery directory {directory}: {error}"
                ) from error
    return deleted_count, deleted_bytes, absent_count


def write_activated_source(repo_id: str, revision: str, manifest: dict[str, Any]) -> None:
    source = read_json(SOURCE_CONFIG_PATH)
    if not isinstance(source, dict):
        raise AssetPipelineError(
            f"Invalid template asset source configuration: {SOURCE_CONFIG_PATH}"
        )
    source.update(
        {
            "mode": "huggingface",
            "repoId": repo_id,
            "revision": revision,
            "assetSetId": manifest["assetSetId"],
        }
    )
    write_json(SOURCE_CONFIG_PATH, source)
    print(f"Activated public Dataset {repo_id}@{revision}")


def activate_source(repo_id: str, revision: str) -> None:
    manifest = validate_checked_manifest_contract()
    if manifest.get("status") != "ready" or manifest.get("missingAssets"):
        raise AssetPipelineError(
            "Activation requires a ready checked-in asset manifest with zero missing assets."
        )
    verify_public_remote_snapshot(repo_id, revision, manifest)
    write_activated_source(repo_id, revision, manifest)


def command_inventory(args: argparse.Namespace) -> int:
    manifest, missing = build_manifest(args.asset_version)
    if args.write:
        write_json(ASSET_MANIFEST_PATH, manifest)
        print(f"Wrote {ASSET_MANIFEST_PATH.relative_to(CLIENT_ROOT)}")
    print_inventory(manifest)
    return 2 if missing else 0


def command_verify(_: argparse.Namespace) -> int:
    manifest = verify_checked_manifest(require_ready=True)
    print(
        f"Verified {manifest['assetCount']} assets ({format_bytes(manifest['totalBytes'])})."
    )
    print(manifest["assetSetId"])
    return 0


def command_rights_template(args: argparse.Namespace) -> int:
    manifest = verify_checked_manifest(require_ready=False)
    ledger = build_rights_template(manifest)
    if args.write:
        write_json(ASSET_RIGHTS_PATH, ledger)
        print(f"Wrote {ASSET_RIGHTS_PATH.relative_to(CLIENT_ROOT)}")
    held = sum(
        record.get("publishDecision") != "approved" for record in ledger["records"]
    )
    print(f"Rights records: {len(ledger['records'])}; held: {held}")
    print(ledger["assetSetId"])
    return 2 if held else 0


def command_upload(args: argparse.Namespace) -> int:
    if not args.public:
        raise AssetPipelineError(
            "Upload requires --public to acknowledge that all Gallery files will be world-readable."
        )
    if not args.confirm_redistribution_rights:
        raise AssetPipelineError(
            "Upload requires --confirm-redistribution-rights after reviewing every input, output, model term, and provenance record."
        )
    validate_repo_id(args.repo_id)
    manifest = verify_checked_manifest(require_ready=True)
    # Validate local legal metadata before authentication, repository creation,
    # visibility changes, or any other external Hub mutation.
    validate_dataset_licensing()
    validate_asset_rights(manifest)
    HfApi, _, _ = require_hub()
    api = HfApi()
    ensure_public_repo(
        api, args.repo_id, create=args.create, make_public=args.make_public
    )
    with tempfile.TemporaryDirectory(prefix="modiff-template-assets-") as temporary:
        staging = Path(temporary)
        stage_upload(manifest, staging)
        result = api.upload_folder(
            repo_id=args.repo_id,
            repo_type="dataset",
            folder_path=staging,
            commit_message=f"Publish MoDiff template Gallery {manifest['assetSetId']}",
            ignore_patterns=["**/.DS_Store", "**/Thumbs.db", "**/.cache/**"],
            # A Dataset update must be an exact replacement of MoDiff-owned
            # payloads, not an additive upload that leaves revoked/stale bytes
            # reachable. README.md and Hub-managed .gitattributes are outside
            # these prefixes and remain untouched.
            delete_patterns=["template-gallery/**", "_modiff/**", "LICENSE"],
        )
    revision = getattr(result, "oid", None)
    if not isinstance(revision, str) or not COMMIT_PATTERN.fullmatch(revision):
        revision = api.repo_info(repo_id=args.repo_id, repo_type="dataset").sha
    validate_revision(revision)
    # Do not trust authenticated upload success alone. Re-download the exact
    # commit anonymously and hash every byte before reporting success or
    # changing the checked-in runtime source.
    verify_public_remote_snapshot(args.repo_id, revision, manifest)
    print(f"Uploaded and verified public Dataset revision: {revision}")
    print(
        "Public manifest URL: "
        f"https://huggingface.co/datasets/{args.repo_id}/resolve/{revision}/_modiff/template-assets.v1.json"
    )
    if args.activate:
        write_activated_source(args.repo_id, revision, manifest)
    else:
        print(
            "After checking the public URL without signing in, activate it with:\n"
            f"  python scripts/template-gallery-assets.py activate --repo-id {args.repo_id} --revision {revision}"
        )
    return 0


def command_upload_provisional(args: argparse.Namespace) -> int:
    if not args.public:
        raise AssetPipelineError(
            "Provisional upload requires --public to acknowledge that every uploaded file will be world-readable."
        )
    if not args.confirm_redistribution_rights:
        raise AssetPipelineError(
            "Provisional upload requires --confirm-redistribution-rights for the approved subset."
        )
    validate_repo_id(args.repo_id)
    manifest = verify_checked_manifest(require_ready=True)
    # All local licensing and rights checks happen before authentication or
    # any other external Hub mutation.
    validate_dataset_licensing()
    ledger = validate_asset_rights(manifest, allow_held=True)
    provisional_manifest, provisional_ledger, held_paths = (
        build_provisional_publication(manifest, ledger)
    )
    HfApi, _, _ = require_hub()
    api = HfApi()
    ensure_public_repo(
        api, args.repo_id, create=args.create, make_public=args.make_public
    )
    with tempfile.TemporaryDirectory(
        prefix="modiff-template-assets-provisional-"
    ) as temporary:
        staging = Path(temporary)
        staged_manifest, staged_ledger, staged_held_paths = (
            stage_provisional_upload(manifest, staging)
        )
        if (
            canonical_json_bytes(staged_manifest)
            != canonical_json_bytes(provisional_manifest)
            or canonical_json_bytes(staged_ledger)
            != canonical_json_bytes(provisional_ledger)
            or staged_held_paths != held_paths
        ):
            raise AssetPipelineError(
                "The provisional publication changed during staging."
            )
        result = api.upload_folder(
            repo_id=args.repo_id,
            repo_type="dataset",
            folder_path=staging,
            commit_message=(
                "Publish provisional MoDiff template Gallery approved subset "
                f"{provisional_manifest['assetSetId']}"
            ),
            ignore_patterns=["**/.DS_Store", "**/Thumbs.db", "**/.cache/**"],
            delete_patterns=["template-gallery/**", "_modiff/**", "LICENSE"],
        )
    revision = getattr(result, "oid", None)
    if not isinstance(revision, str) or not COMMIT_PATTERN.fullmatch(revision):
        revision = api.repo_info(repo_id=args.repo_id, repo_type="dataset").sha
    validate_revision(revision)
    verify_public_provisional_snapshot(
        args.repo_id, revision, provisional_manifest, provisional_ledger
    )
    print(f"Uploaded and verified provisional public Dataset revision: {revision}")
    print(f"Published assets: {provisional_manifest['assetCount']}")
    print(f"Withheld assets: {len(held_paths)}")
    for path in held_paths:
        print(f"  WITHHELD {path}")
    print("MoDiff remains in local asset mode; this provisional revision cannot be activated.")
    return 0


def command_activate(args: argparse.Namespace) -> int:
    activate_source(args.repo_id, args.revision)
    return 0


def command_verify_remote(args: argparse.Namespace) -> int:
    source = read_json(SOURCE_CONFIG_PATH)
    repo_id = args.repo_id or source.get("repoId")
    revision = args.revision or source.get("revision")
    if not isinstance(repo_id, str) or not isinstance(revision, str):
        raise AssetPipelineError(
            "No activated Dataset source exists; pass --repo-id and --revision."
        )
    if args.full:
        manifest = validate_checked_manifest_contract()
        verify_public_remote_snapshot(repo_id, revision, manifest)
    else:
        manifest = assert_remote_manifest_matches(repo_id, revision)
    print(
        f"Verified public Dataset manifest for {manifest['assetCount']} assets at {repo_id}@{revision}."
    )
    if args.full:
        print("Verified every remote asset byte from the unauthenticated Hub cache.")
    return 0


def command_prune_local(args: argparse.Namespace) -> int:
    if not args.confirm_delete_local_assets:
        raise AssetPipelineError(
            "Local pruning requires --confirm-delete-local-assets after the public Dataset and Linux application have been validated."
        )
    manifest = validate_checked_manifest_contract()
    if manifest.get("status") != "ready" or manifest.get("missingAssets"):
        raise AssetPipelineError(
            "Local pruning requires a ready checked-in asset manifest with zero missing assets."
        )
    repo_id, revision = activated_remote_source(manifest)
    # All network and local path/hash checks finish before the first unlink.
    targets = local_prune_targets(manifest)
    verify_public_remote_snapshot(repo_id, revision, manifest)
    # Recheck the complete local set because full remote verification can take
    # long enough for a concurrent local change to invalidate the first pass.
    targets = local_prune_targets(manifest)
    deleted_count, deleted_bytes, absent_count = prune_exact_local_assets(targets)
    print(
        f"Pruned {deleted_count} verified local Gallery asset(s) ({format_bytes(deleted_bytes)})."
    )
    print(
        "Preserved the Gallery manifest and runtime default-input bindings metadata."
    )
    if absent_count:
        print(f"Already absent: {absent_count} manifest-listed asset(s).")
    print(f"Verified public source: {repo_id}@{revision}")
    return 0


def verify_materialized_assets(
    root: Path,
    manifest: dict[str, Any],
    *,
    reject_unexpected: bool = False,
) -> None:
    failures: list[str] = []
    for record in manifest["assets"]:
        relative_path = manifest_record_relative_path(record)
        declared_path = f"template-gallery/{relative_path}"
        path = root / "template-gallery" / relative_path
        if not path.is_file():
            failures.append(f"missing {declared_path}")
            continue
        if path.stat().st_size != record["size"]:
            failures.append(f"size mismatch {declared_path}")
            continue
        actual = f"sha256:bytes:{sha256_file(path)}"
        if actual != record["sha256"]:
            failures.append(f"hash mismatch {declared_path}")
    if reject_unexpected:
        expected_paths = {
            f"template-gallery/{manifest_record_relative_path(record)}"
            for record in manifest["assets"]
        }
        expected_paths.add("_modiff/template-assets.v1.json")
        expected_paths.add("_modiff/template-asset-rights.v1.json")
        actual_paths = {
            path.relative_to(root).as_posix()
            for managed_root in (root / "template-gallery", root / "_modiff")
            if managed_root.is_dir()
            for path in managed_root.rglob("*")
            if path.is_file()
        }
        for unexpected in sorted(actual_paths - expected_paths):
            failures.append(f"unexpected managed file {unexpected}")
    if failures:
        raise AssetPipelineError(
            "Downloaded Gallery verification failed:\n  - " + "\n  - ".join(failures)
        )


def ensure_safe_destination_parent(root: Path, relative_path: str) -> Path:
    """Create one asset parent without accepting redirects inside the root."""

    if path_is_link_or_reparse_point(root):
        raise AssetPipelineError(
            f"Download destination must not be a link or reparse point: {root}"
        )
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise AssetPipelineError(
            f"Could not create download destination {root}: {error}"
        ) from error
    try:
        root_metadata = root.lstat()
    except OSError as error:
        raise AssetPipelineError(
            f"Could not inspect download destination {root}: {error}"
        ) from error
    if not stat.S_ISDIR(root_metadata.st_mode):
        raise AssetPipelineError(f"Download destination is not a directory: {root}")

    parent = root / "template-gallery"
    for segment in relative_path.split("/")[:-1]:
        parent /= segment
    try:
        parent.relative_to(root)
    except ValueError as error:
        raise AssetPipelineError(
            f"Download destination escaped its root: {parent}"
        ) from error

    current = root
    for segment in parent.relative_to(root).parts:
        current /= segment
        if path_is_link_or_reparse_point(current):
            raise AssetPipelineError(
                "Download destination tree must not contain links or reparse "
                f"points: {current}"
            )
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            try:
                current.mkdir()
                metadata = current.lstat()
            except OSError as error:
                raise AssetPipelineError(
                    f"Could not create download directory {current}: {error}"
                ) from error
        if not stat.S_ISDIR(metadata.st_mode):
            raise AssetPipelineError(
                f"Download destination ancestor is not a directory: {current}"
            )
    return parent


def assert_safe_destination_tree(root: Path, destination: Path) -> os.stat_result:
    try:
        destination.relative_to(root)
    except ValueError as error:
        raise AssetPipelineError(
            f"Download destination escaped its root: {destination}"
        ) from error
    current = root
    if path_is_link_or_reparse_point(current):
        raise AssetPipelineError(
            f"Download destination must not be a link or reparse point: {current}"
        )
    for segment in destination.parent.relative_to(root).parts:
        current /= segment
        if path_is_link_or_reparse_point(current):
            raise AssetPipelineError(
                "Download destination tree changed to a link or reparse point: "
                f"{current}"
            )
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            raise AssetPipelineError(
                f"Download destination tree changed during restore: {current}"
            ) from None
        if not stat.S_ISDIR(metadata.st_mode):
            raise AssetPipelineError(
                f"Download destination ancestor is not a directory: {current}"
            )
    try:
        return destination.parent.lstat()
    except OSError as error:
        raise AssetPipelineError(
            f"Could not inspect download destination parent {destination.parent}: {error}"
        ) from error


def copy_verified_asset_atomically(
    source: Path,
    destination: Path,
    record: dict[str, Any],
    *,
    destination_root: Path,
    expected_destination_identity: tuple[int, int, int, int, int] | None,
) -> None:
    """Copy through a verified sibling temp file, then atomically install it."""

    parent_metadata = assert_safe_destination_tree(destination_root, destination)
    temporary_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    temporary_path = Path(temporary_name)
    try:
        try:
            with (
                source.open("rb") as source_handle,
                os.fdopen(temporary_descriptor, "wb") as destination_handle,
            ):
                temporary_descriptor = -1
                shutil.copyfileobj(source_handle, destination_handle, BUFFER_SIZE)
                destination_handle.flush()
                os.fsync(destination_handle.fileno())
            os.chmod(temporary_path, 0o644)
        except OSError as error:
            raise AssetPipelineError(
                f"Could not copy Gallery asset {record['path']}: {error}"
            ) from error

        temporary_metadata, temporary_sha256 = inspect_regular_file(
            temporary_path, context="Temporary downloaded Gallery asset"
        )
        if (
            temporary_metadata.st_size != record["size"]
            or temporary_sha256 != record["sha256"]
        ):
            raise AssetPipelineError(
                f"Copied Gallery asset does not match its manifest: {record['path']}"
            )

        latest_parent = assert_safe_destination_tree(destination_root, destination)
        if filesystem_identity(latest_parent) != filesystem_identity(parent_metadata):
            raise AssetPipelineError(
                f"Download destination parent changed during restore: {destination.parent}"
            )
        if path_is_link_or_reparse_point(destination):
            raise AssetPipelineError(
                f"Download destination changed to a link or reparse point: {destination}"
            )
        try:
            existing = destination.lstat()
        except FileNotFoundError:
            existing = None
        if expected_destination_identity is None:
            if existing is not None:
                raise AssetPipelineError(
                    f"Download destination appeared during restore: {destination}"
                )
        elif existing is None or stable_file_identity(
            existing
        ) != expected_destination_identity:
            raise AssetPipelineError(
                f"Download destination changed during restore: {destination}"
            )
        try:
            os.replace(temporary_path, destination)
        except OSError as error:
            raise AssetPipelineError(
                f"Could not atomically install Gallery asset {destination}: {error}"
            ) from error
    finally:
        if temporary_descriptor >= 0:
            os.close(temporary_descriptor)
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass


def command_download(args: argparse.Namespace) -> int:
    source = read_json(SOURCE_CONFIG_PATH)
    repo_id = args.repo_id or source.get("repoId")
    revision = args.revision or source.get("revision")
    if not isinstance(repo_id, str) or not isinstance(revision, str):
        raise AssetPipelineError(
            "No activated Dataset source exists; pass --repo-id and --revision."
        )
    manifest = assert_remote_manifest_matches(repo_id, revision)
    _, _, snapshot_download = require_hub()
    snapshot = Path(
        snapshot_download(
            repo_id=repo_id,
            repo_type="dataset",
            revision=revision,
            token=False,
            allow_patterns=["template-gallery/**", "_modiff/template-assets.v1.json"],
        )
    )
    # Verify the complete cache snapshot before touching the destination. Hub
    # snapshots may themselves use internal symlinks, so downloaded bytes are
    # copied rather than linked into the working tree.
    verify_materialized_assets(snapshot, manifest)
    requested_destination = Path(args.destination).expanduser()
    if not requested_destination.is_absolute():
        requested_destination = Path.cwd() / requested_destination
    if path_is_link_or_reparse_point(requested_destination):
        raise AssetPipelineError(
            "Download destination must not itself be a link or reparse point: "
            f"{requested_destination}"
        )
    destination = requested_destination.resolve(strict=False)
    planned: list[
        tuple[Path, Path, dict[str, Any], tuple[int, int, int, int, int] | None]
    ] = []
    for record in manifest["assets"]:
        relative_path = manifest_record_relative_path(record)
        source_path = snapshot / "template-gallery" / relative_path
        ensure_safe_destination_parent(destination, relative_path)
        destination_path = destination / "template-gallery" / relative_path
        if path_is_link_or_reparse_point(destination_path):
            raise AssetPipelineError(
                f"Refusing to replace linked local asset {destination_path}."
            )
        try:
            destination_path.lstat()
        except FileNotFoundError:
            existing_metadata = None
            existing_sha256 = None
        else:
            existing_metadata, existing_sha256 = inspect_regular_file(
                destination_path, context="Existing local Gallery asset"
            )
            if (
                existing_metadata.st_size == record["size"]
                and existing_sha256 == record["sha256"]
            ):
                continue
            if not args.replace:
                raise AssetPipelineError(
                    f"Refusing to replace mismatched local asset {destination_path}; re-run with --replace."
                )
        planned.append(
            (
                source_path,
                destination_path,
                record,
                stable_file_identity(existing_metadata)
                if existing_metadata is not None
                else None,
            )
        )
    for source_path, destination_path, record, expected_identity in planned:
        copy_verified_asset_atomically(
            source_path,
            destination_path,
            record,
            destination_root=destination,
            expected_destination_identity=expected_identity,
        )
    verify_materialized_assets(destination, manifest)
    print(
        f"Downloaded and verified {manifest['assetCount']} assets under {destination}."
    )
    print("Build an offline bundle with VITE_MODIFF_TEMPLATE_ASSET_MODE=local.")
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)

    inventory = commands.add_parser(
        "inventory", help="Inventory only app/tooling-referenced Gallery files."
    )
    inventory.add_argument("--asset-version", default="v1")
    inventory.add_argument(
        "--write",
        action="store_true",
        help="Update config/template-assets.v1.json atomically.",
    )
    inventory.set_defaults(handler=command_inventory)

    verify = commands.add_parser(
        "verify", help="Verify the checked-in manifest and every required local byte."
    )
    verify.set_defaults(handler=command_verify)

    rights = commands.add_parser(
        "rights-template",
        help="Create or refresh the fail-closed per-asset redistribution-rights ledger.",
    )
    rights.add_argument(
        "--write",
        action="store_true",
        help="Write config/template-asset-rights.v1.json atomically.",
    )
    rights.set_defaults(handler=command_rights_template)

    upload = commands.add_parser(
        "upload", help="Upload the ready asset set to a public Hugging Face Dataset."
    )
    upload.add_argument("--repo-id", required=True)
    upload.add_argument(
        "--public",
        action="store_true",
        help="Acknowledge that every uploaded file is public.",
    )
    upload.add_argument(
        "--confirm-redistribution-rights",
        action="store_true",
        help="Acknowledge a completed redistribution-rights and provenance review.",
    )
    upload.add_argument(
        "--create",
        action="store_true",
        help="Create the public Dataset if it does not exist.",
    )
    upload.add_argument(
        "--make-public",
        action="store_true",
        help="Make an existing private Dataset public.",
    )
    upload.add_argument(
        "--activate",
        action="store_true",
        help="Activate the verified commit immediately.",
    )
    upload.set_defaults(handler=command_upload)

    provisional = commands.add_parser(
        "upload-provisional",
        help="Upload only rights-approved files without activating the incomplete set.",
    )
    provisional.add_argument("--repo-id", required=True)
    provisional.add_argument(
        "--public",
        action="store_true",
        help="Acknowledge that every uploaded approved file is public.",
    )
    provisional.add_argument(
        "--confirm-redistribution-rights",
        action="store_true",
        help="Acknowledge the recorded review for the approved subset.",
    )
    provisional.add_argument(
        "--create",
        action="store_true",
        help="Create the public Dataset if it does not exist.",
    )
    provisional.add_argument(
        "--make-public",
        action="store_true",
        help="Make an existing private Dataset public.",
    )
    provisional.set_defaults(handler=command_upload_provisional)

    activate = commands.add_parser(
        "activate", help="Pin the application to an already-uploaded Dataset commit."
    )
    activate.add_argument("--repo-id", required=True)
    activate.add_argument("--revision", required=True)
    activate.set_defaults(handler=command_activate)

    remote = commands.add_parser(
        "verify-remote", help="Verify the public pinned Dataset manifest."
    )
    remote.add_argument("--repo-id")
    remote.add_argument("--revision")
    remote.add_argument(
        "--full",
        action="store_true",
        help="Download and SHA-256 verify every public asset.",
    )
    remote.set_defaults(handler=command_verify_remote)

    prune = commands.add_parser(
        "prune-local",
        help="Remove verified local Gallery bytes after a public Dataset cutover.",
    )
    prune.add_argument(
        "--confirm-delete-local-assets",
        action="store_true",
        help="Confirm deletion of exact manifest-listed local assets after remote validation.",
    )
    prune.set_defaults(handler=command_prune_local)

    download = commands.add_parser(
        "download", help="Restore a verified offline Gallery from the pinned Dataset."
    )
    download.add_argument("--repo-id")
    download.add_argument("--revision")
    download.add_argument("--destination", default=str(CLIENT_ROOT / "public"))
    download.add_argument("--replace", action="store_true")
    download.set_defaults(handler=command_download)
    return root


def main(argv: Iterable[str] | None = None) -> int:
    args = parser().parse_args(list(argv) if argv is not None else None)
    try:
        return int(args.handler(args))
    except AssetPipelineError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
