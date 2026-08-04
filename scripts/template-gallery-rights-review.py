#!/usr/bin/env python3
"""Seed and human-review the Template Gallery's SHA-bound rights ledger.

The seeding pass derives technical fields from the checked asset manifest,
Gallery manifest, live-proof provenance, and runtime input bindings. It never
turns a held record into an approval. The attest pass is deliberately explicit:
it records one human review across the exact current bytes and refuses the two
upstream-permission groups unless permission evidence is supplied.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
GALLERY = ROOT / "public" / "template-gallery"
MANIFEST_PATH = ROOT / "config" / "template-assets.v1.json"
RIGHTS_PATH = ROOT / "config" / "template-asset-rights.v1.json"
GALLERY_MANIFEST_PATH = GALLERY / "manifest.json"
INPUT_BINDINGS_PATH = GALLERY / "runtime-inputs" / "default-input-bindings.json"
SOURCE_ASSETS_PATH = ROOT / "scripts" / "template-gallery-source-assets.json"

RESTRICTED_MODEL_MARKERS = (
    "Lightricks/LTX-Video",
    "black-forest-labs/FLUX.1-",
    "Norod78/Flux_1_Dev_LoRA",
    "SebastianBodza/Flux_Aquarell",
    "XLabs-AI/flux-RealismLora",
    "dvyio/flux-lora-film-noir",
    "renderartist/retrocomicflux",
)
MODEL_LICENSES = {
    "ACE-Step/acestep-v15-xl-turbo-diffusers": "MIT",
    "InstantX/Qwen-Image-ControlNet-Union": "Apache-2.0",
    "Lightricks/LTX-Video-0.9.8-13B-distilled": "LTXV Open Weights License 0.X",
    "Norod78/Flux_1_Dev_LoRA_Paper-Cutout-Style": "FLUX.1-dev terms",
    "Qwen/Qwen-Image-2512": "Apache-2.0",
    "Qwen/Qwen-Image-Edit": "Apache-2.0",
    "Qwen/Qwen-Image-Edit-2511": "Apache-2.0",
    "Qwen/Qwen-Image-Layered": "Apache-2.0",
    "SebastianBodza/Flux_Aquarell_Watercolor_v2": "FLUX.1-dev non-commercial terms",
    "Tongyi-MAI/Z-Image-Turbo": "Apache-2.0",
    "Wan-AI/Wan2.1-T2V-1.3B-Diffusers": "Apache-2.0",
    "Wan-AI/Wan2.1-VACE-1.3B-diffusers": "Apache-2.0",
    "Wan-AI/Wan2.2-TI2V-5B-Diffusers": "Apache-2.0",
    "XLabs-AI/flux-RealismLora": "FLUX.1-dev non-commercial terms",
    "amd/realesrgan-x4plus": "BSD-3-Clause",
    "black-forest-labs/FLUX.1-Canny-dev": "FLUX.1-dev Non-Commercial License",
    "black-forest-labs/FLUX.1-Depth-dev": "FLUX.1-dev Non-Commercial License",
    "black-forest-labs/FLUX.1-Fill-dev": "FLUX.1-dev Non-Commercial License",
    "black-forest-labs/FLUX.1-Kontext-dev": "FLUX.1-dev Non-Commercial License",
    "black-forest-labs/FLUX.1-Krea-dev": "FLUX.1-dev Non-Commercial License",
    "black-forest-labs/FLUX.1-Redux-dev": "FLUX.1-dev Non-Commercial License",
    "black-forest-labs/FLUX.1-dev": "FLUX.1-dev Non-Commercial License",
    "black-forest-labs/FLUX.1-schnell": "Apache-2.0",
    "black-forest-labs/FLUX.2-klein-4B": "Apache-2.0",
    "dtthanh/flux_oil_painting_lora": "Apache-2.0",
    "dvyio/flux-lora-film-noir": "FLUX.1-dev non-commercial terms",
    "lightx2v/Qwen-Image-Edit-2511-Lightning": "Apache-2.0",
    "nateraw/real-esrgan": "BSD-3-Clause",
    "renderartist/retrocomicflux": "CreativeML Open RAIL-M",
    "unsloth/Qwen-Image-2512-unsloth-bnb-4bit": "Apache-2.0",
    "youknownothing/v1-realism-v1-adapter-ZIT-lora": "Apache-2.0",
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def split_models(value: str | None) -> list[tuple[str, str | None]]:
    models: list[tuple[str, str | None]] = []
    for item in (value or "").split("|"):
        item = item.strip()
        if not item or item == "null":
            continue
        match = re.fullmatch(r"(.+?)@([0-9a-f]{40})", item)
        models.append((match.group(1), match.group(2)) if match else (item, None))
    return models


def model_terms(value: str | None) -> list[str]:
    terms = []
    for repo, revision in split_models(value):
        license_name = MODEL_LICENSES.get(repo, "Upstream model-card terms")
        url = f"https://huggingface.co/{repo}"
        if revision:
            url += f"/tree/{revision}"
        terms.append(f"{repo}: {license_name}; {url}")
    return terms


def model_source_url(value: str | None) -> str | None:
    models = split_models(value)
    if not models:
        return None
    repo, revision = models[0]
    suffix = f"/tree/{revision}" if revision else ""
    return f"https://huggingface.co/{repo}{suffix}"


def is_restricted_model(value: str | None) -> bool:
    return any(marker in (value or "") for marker in RESTRICTED_MODEL_MARKERS)


def template_for_path(path: str, template_ids: list[str]) -> str | None:
    relative = path.removeprefix("template-gallery/")
    if relative.startswith("reviews/"):
        name = relative.removeprefix("reviews/")
    elif relative.startswith("inputs/"):
        name = relative.removeprefix("inputs/")
    else:
        name = relative
    for template_id in template_ids:
        if name == template_id or name.startswith(template_id + "."):
            return template_id
    return None


def build_input_sources() -> tuple[dict[str, str], dict[str, set[str]]]:
    source_assets = read_json(SOURCE_ASSETS_PATH).get("assets", [])
    generation_template_by_filename = {
        item.get("stagedFilename"): item.get("template")
        for item in source_assets
        if isinstance(item, dict)
    }
    source_by_hash: dict[str, str] = {}
    consumers_by_hash: dict[str, set[str]] = {}
    for provenance_path in (GALLERY / "reviews").glob("*.provenance.json"):
        provenance = read_json(provenance_path)
        template_id = provenance.get("templateId")
        runs = [
            value
            for key, value in provenance.items()
            if key == "run" or re.fullmatch(r"run\d+", key)
        ]
        for run in runs:
            for item in ((run or {}).get("inputs") or {}).get("items", []):
                content_hash = str(item.get("contentHash") or "").removeprefix("sha256:bytes:")
                filename = Path(str(item.get("path") or "")).name
                source_template = generation_template_by_filename.get(filename)
                if content_hash and source_template:
                    source_by_hash[content_hash] = source_template
                if content_hash and template_id:
                    consumers_by_hash.setdefault(content_hash, set()).add(template_id)
    return source_by_hash, consumers_by_hash


def runtime_hash_templates() -> dict[str, set[str]]:
    bindings = read_json(INPUT_BINDINGS_PATH)
    result: dict[str, set[str]] = {}
    for template_id, groups in bindings.items():
        for group in groups:
            for asset in group.get("defaultAssets", []):
                sha = str(asset.get("runtimeSha256") or "").removeprefix("sha256:bytes:")
                if sha:
                    result.setdefault(sha, set()).add(template_id)
    return result


def seed_record(
    record: dict[str, Any],
    examples: dict[str, dict[str, Any]],
    template_ids: list[str],
    input_source_templates: dict[str, str],
    input_consumers: dict[str, set[str]],
    runtime_consumers: dict[str, set[str]],
) -> dict[str, Any]:
    path = record["path"]
    relative = path.removeprefix("template-gallery/")
    is_metadata = relative == "manifest.json" or relative.endswith(".json")
    template_id = template_for_path(path, template_ids)
    digest_name = Path(relative).stem if relative.startswith("runtime-inputs/assets/") else None
    if digest_name and re.fullmatch(r"[0-9a-f]{64}", digest_name):
        source_template = input_source_templates.get(digest_name)
        consumers = sorted(runtime_consumers.get(digest_name, set()))
    else:
        source_template = None
        consumers = []

    if relative.startswith("inputs/") and template_id:
        provenance = GALLERY / "reviews" / f"{template_id}.reviewed-provenance.json"
        if not provenance.exists():
            provenance = GALLERY / "reviews" / f"{template_id}.duplicate-provenance.json"
        if provenance.exists():
            value = read_json(provenance)
            runs = [
                item
                for key, item in value.items()
                if key == "run" or re.fullmatch(r"run\d+", key)
            ]
            hashes = [
                str(item.get("contentHash") or "").removeprefix("sha256:bytes:")
                for run in runs
                for item in ((run or {}).get("inputs") or {}).get("items", [])
            ]
            if hashes:
                source_template = input_source_templates.get(hashes[0], source_template)
                consumers = sorted(input_consumers.get(hashes[0], {template_id}))

    provenance_template = source_template or template_id
    revision = (examples.get(provenance_template or "") or {}).get("modelRevision")
    if not revision and template_id:
        revision = (examples.get(template_id) or {}).get("modelRevision")

    review_class = "standard-human-attestation"
    hold_reason = (
        "Human maintainer must attest control of these exact bytes and approve the recorded mixed terms."
    )
    marks: list[str] = []
    required_attribution: list[str] = []

    if relative.startswith("reviews/") or relative in {
        "manifest.json",
        "runtime-inputs/default-input-bindings.json",
    }:
        is_metadata = True
        ai_generated = False
        creation_method = "MoDiff-authored technical metadata or review record"
        creator = "MoDiff project maintainers"
        source_license = "Apache-2.0"
        asset_license = "Apache-2.0"
        terms: list[str] = []
        source_url = None
        source_revision = None
    else:
        ai_generated = True
        creation_method = "AI-generated Gallery media or deterministic derivative"
        creator = "MoDiff project maintainers, subject to the recorded source and model terms"
        source_license = "Original generation or recorded workflow input; see modelTerms"
        terms = model_terms(revision)
        source_url = model_source_url(revision)
        source_revision = revision
        asset_license = (
            "MoDiff-Gallery-Restricted-1.0" if is_restricted_model(revision) else "Apache-2.0"
        )

    if template_id == "flux_lora_cinematic_octane_3d" and relative.endswith(
        ".card-poster.webp"
    ):
        creation_method = "OpenAI-assisted independent Gallery card-poster generation and WebP conversion"
        creator = "MoDiff project maintainer (OpenAI-assisted generation)"
        source_license = "Original generation"
        source_url = "https://openai.com/policies/terms-of-use/"
        source_revision = "Generated 2026-08-03"
        terms = [
            "OpenAI Terms of Use: as between the user and OpenAI, the user owns Output to the extent permitted by law; https://openai.com/policies/terms-of-use/"
        ]
        asset_license = "MoDiff-Gallery-Restricted-1.0"

    is_rocket = template_id == "ltx_video_video_to_video" or (
        digest_name == "233d1b3a123fceb4f3b68d2d3a9f5b4129627073b8235fe7248ae6ebdeecb554"
    )
    if is_rocket and not is_metadata:
        source_license = "CC-BY-NC-SA-4.0"
        asset_license = "CC-BY-NC-SA-4.0"
        source_url = "https://huggingface.co/datasets/huggingface/documentation-images"
        required_attribution = [
            "Source: Hugging Face documentation-images Dataset, CC BY-NC-SA 4.0; modified by the MoDiff LTX workflow."
        ]
        if not terms:
            terms = model_terms((examples.get("ltx_video_video_to_video") or {}).get("modelRevision"))

    if template_id == "ace_step_chinese_new_year_lora" and not is_metadata:
        review_class = "upstream-permission-required"
        hold_reason = (
            "Obtain written permission to publicly redistribute the generated example; the adapter card limits use to research/academic exchange and prohibits commercial use."
        )
        source_license = "CreativeML Open RAIL-M plus adapter research/non-commercial notice"
        asset_license = "upstream-terms-only"
        source_url = "https://huggingface.co/ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA"
        source_revision = "adapter_model.safetensors SHA-256 78650245c79cbfda7169eae34eb2ccb5f5e639b31a99da0a153a5bbd74194b0d"
        terms = [
            "ACE-Step Chinese New Year LoRA: research and academic exchange only; commercial use prohibited; https://huggingface.co/ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA"
        ]
        marks = ["Singer-style and training-song rights require upstream confirmation"]

    if template_id == "flux_lora_ghibli_story" and not is_metadata:
        review_class = "upstream-permission-required"
        hold_reason = (
            "Obtain written permission to publicly redistribute the generated example; the adapter card states personal-use-only and non-commercial use."
        )
        source_license = "FLUX.1-dev terms plus adapter personal/non-commercial notice"
        asset_license = "upstream-terms-only"
        source_url = "https://huggingface.co/alvarobartt/ghibli-characters-flux-lora"
        source_revision = "ed846114c71efc525e7f5a51e274dc976bb970a8"
        terms = [
            "Ghibli characters FLUX LoRA: personal-use-only and non-commercial; https://huggingface.co/alvarobartt/ghibli-characters-flux-lora",
            "FLUX.1-dev output terms; https://huggingface.co/black-forest-labs/FLUX.1-dev/blob/3de623fc3c33e44ffbe2bad470d0f45bccf2eb21/LICENSE.md",
        ]
        marks = ["Studio Ghibli style reference; no franchise character requested"]

    if ai_generated and not terms:
        terms = [
            "Independent Gallery media: exact generation model was not captured in checked provenance; human output-rights attestation required."
        ]
        asset_license = "MoDiff-Gallery-Restricted-1.0"

    seeded = {
        **record,
        "publishDecision": "hold",
        "holdReason": hold_reason,
        "reviewClass": review_class,
        "creatorOrRightsholder": creator,
        "creationMethod": creation_method,
        "sourceUrl": source_url,
        "sourceRevision": source_revision,
        "sourceLicense": source_license,
        "modelTerms": terms,
        "aiGenerated": ai_generated,
        "humanLikenessConsent": "synthetic" if ai_generated else "not-applicable",
        "marks": marks,
        "requiredAttribution": required_attribution,
        "assetLicense": asset_license,
        "reviewedBy": None,
        "reviewedAt": None,
    }
    if provenance_template:
        seeded["provenanceTemplateId"] = provenance_template
    if consumers:
        seeded["consumingTemplateIds"] = consumers
    return seeded


def seed(write: bool) -> dict[str, Any]:
    manifest = read_json(MANIFEST_PATH)
    ledger = read_json(RIGHTS_PATH)
    gallery_manifest = read_json(GALLERY_MANIFEST_PATH)
    examples = {item["templateId"]: item for item in gallery_manifest.get("examples", [])}
    template_ids = sorted(
        {
            *(examples.keys()),
            *(
                path.name.split(".quality-review.json", 1)[0]
                for path in (GALLERY / "reviews").glob("*.quality-review.json")
            ),
            "ace_step_chinese_new_year_lora",
            "ace_step_custom_lora",
            "flux_lora_cinematic_octane_3d",
            "wan_21_t2v_13b_seed_vault",
            "wan_22_i2v_seed_vault",
            "wan_vace_direct_text_to_video",
            "wan_vace_masked_object_replace",
            "wan_video_long_showcase",
        },
        key=lambda value: (-len(value), value),
    )
    source_templates, input_consumers = build_input_sources()
    runtime_consumers = runtime_hash_templates()
    seeded_records = [
        seed_record(
            record,
            examples,
            template_ids,
            source_templates,
            input_consumers,
            runtime_consumers,
        )
        for record in ledger["records"]
    ]
    seeded = {
        "schemaVersion": 1,
        "assetSetId": manifest["assetSetId"],
        "records": seeded_records,
    }
    if write:
        write_json(RIGHTS_PATH, seeded)
    return seeded


def summary(ledger: dict[str, Any]) -> dict[str, Any]:
    records = ledger["records"]
    by_class: dict[str, int] = {}
    by_license: dict[str, int] = {}
    for record in records:
        by_class[record.get("reviewClass", "unclassified")] = (
            by_class.get(record.get("reviewClass", "unclassified"), 0) + 1
        )
        by_license[record.get("assetLicense") or "unset"] = (
            by_license.get(record.get("assetLicense") or "unset", 0) + 1
        )
    return {
        "assetSetId": ledger["assetSetId"],
        "recordCount": len(records),
        "heldCount": sum(record.get("publishDecision") != "approved" for record in records),
        "byReviewClass": dict(sorted(by_class.items())),
        "byAssetLicense": dict(sorted(by_license.items())),
        "permissionRequired": [
            record["path"]
            for record in records
            if record.get("reviewClass") == "upstream-permission-required"
        ],
    }


def attest(args: argparse.Namespace) -> dict[str, Any]:
    ledger = read_json(RIGHTS_PATH)
    if not args.confirm_control or not args.confirm_mixed_terms:
        raise SystemExit(
            "Attestation requires both --confirm-control and --confirm-mixed-terms."
        )
    if args.reviewed_by.strip().casefold() in {
        "your full name",
        "your name",
        "todo",
        "tbd",
    }:
        raise SystemExit("Replace --reviewed-by with the reviewer's actual name.")
    date = args.reviewed_at or dt.date.today().isoformat()
    for record in ledger["records"]:
        if record.get("reviewClass") == "upstream-permission-required":
            continue
        record.update(
            {
                "publishDecision": "approved",
                "holdReason": None,
                "reviewedBy": args.reviewed_by,
                "reviewedAt": date,
            }
        )
    if args.write:
        write_json(RIGHTS_PATH, ledger)
    return ledger


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    seed_parser = commands.add_parser("seed")
    seed_parser.add_argument("--write", action="store_true")
    commands.add_parser("summary")
    attest_parser = commands.add_parser("attest")
    attest_parser.add_argument("--reviewed-by", required=True)
    attest_parser.add_argument("--reviewed-at")
    attest_parser.add_argument("--confirm-control", action="store_true")
    attest_parser.add_argument("--confirm-mixed-terms", action="store_true")
    attest_parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    if args.command == "seed":
        ledger = seed(args.write)
    elif args.command == "attest":
        ledger = attest(args)
    else:
        ledger = read_json(RIGHTS_PATH)
    print(json.dumps(summary(ledger), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
