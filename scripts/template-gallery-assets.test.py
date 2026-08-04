from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


SCRIPT_PATH = Path(__file__).with_name("template-gallery-assets.py")
SPEC = importlib.util.spec_from_file_location("template_gallery_assets", SCRIPT_PATH)
assert SPEC and SPEC.loader
assets = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(assets)


def ready_manifest(records: list[dict[str, object]]) -> dict[str, object]:
    identity_payload = {
        "schemaVersion": 1,
        "assetVersion": "test-v1",
        "assets": records,
    }
    return {
        **identity_payload,
        "assetSetId": "sha256:canonical-json:"
        + assets.sha256_bytes(assets.canonical_json_bytes(identity_payload)),
        "status": "ready",
        "assetCount": len(records),
        "totalBytes": sum(int(record["size"]) for record in records),
        "missingAssets": [],
    }


def asset_record(path: str, payload: bytes) -> dict[str, object]:
    return {
        "path": path,
        "size": len(payload),
        "sha256": "sha256:bytes:" + assets.sha256_bytes(payload),
        "contentType": "application/octet-stream",
        "purposes": ["runtime"],
    }


class TemplateGalleryAssetTests(unittest.TestCase):
    def create_symlink_or_skip(
        self, link: Path, target: Path, *, target_is_directory: bool = False
    ) -> None:
        try:
            link.symlink_to(target, target_is_directory=target_is_directory)
        except OSError as error:
            if getattr(error, "winerror", None) == 1314:
                self.skipTest("Creating symlinks requires Windows Developer Mode or elevation")
            raise

    def test_inspection_accepts_windows_handle_ctime_view_difference(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            candidate = Path(temporary) / "asset.bin"
            candidate.write_bytes(b"verified bytes")
            actual_fstat = assets.os.fstat

            def windows_handle_metadata(descriptor: int) -> SimpleNamespace:
                metadata = actual_fstat(descriptor)
                return SimpleNamespace(
                    st_mode=metadata.st_mode,
                    st_dev=metadata.st_dev,
                    st_ino=metadata.st_ino,
                    st_size=metadata.st_size,
                    st_mtime_ns=metadata.st_mtime_ns,
                    st_ctime_ns=metadata.st_ctime_ns + 2_000_000,
                )

            with patch.object(
                assets.os, "fstat", side_effect=windows_handle_metadata
            ):
                metadata, digest = assets.inspect_regular_file(
                    candidate, context="Test asset"
                )

            self.assertEqual(metadata.st_size, len(b"verified bytes"))
            self.assertEqual(
                digest,
                "sha256:bytes:" + assets.sha256_bytes(b"verified bytes"),
            )

    def test_manifest_is_deterministic_and_only_includes_references(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "public" / "template-gallery"
            gallery.mkdir(parents=True)
            (gallery / "manifest.json").write_text(
                json.dumps({"outputPath": "/template-gallery/result.bin"}),
                encoding="utf-8",
            )
            (gallery / "result.bin").write_bytes(b"result")
            (gallery / "unused.webp").write_bytes(b"unused")
            templates = root / "templates.ts"
            templates.write_text(
                "const poster = '/template-gallery/result.bin';", encoding="utf-8"
            )

            with (
                patch.object(assets, "CLIENT_ROOT", root),
                patch.object(assets, "GALLERY_ROOT", gallery),
                patch.object(
                    assets,
                    "ASSET_MANIFEST_PATH",
                    root / "config" / "template-assets.v1.json",
                ),
                patch.object(
                    assets,
                    "RUNTIME_REFERENCE_SOURCES",
                    (templates, gallery / "manifest.json"),
                ),
                patch.object(assets, "TOOLING_REFERENCE_SOURCES", ()),
                patch.object(
                    assets, "ALWAYS_REQUIRED_BY_PURPOSE", {"manifest.json": {"runtime"}}
                ),
            ):
                first, first_missing = assets.build_manifest("test-v1")
                second, second_missing = assets.build_manifest("test-v1")
                self.assertEqual(first, second)
                self.assertEqual(first_missing, second_missing)
                self.assertEqual(first_missing, [])
                self.assertEqual(first["status"], "ready")
                self.assertEqual(
                    [record["path"] for record in first["assets"]],
                    ["template-gallery/manifest.json", "template-gallery/result.bin"],
                )

    def test_missing_reference_blocks_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "template-gallery"
            gallery.mkdir()
            source = root / "templates.ts"
            source.write_text("'/template-gallery/missing.png'", encoding="utf-8")
            with (
                patch.object(assets, "CLIENT_ROOT", root),
                patch.object(assets, "GALLERY_ROOT", gallery),
                patch.object(
                    assets,
                    "ASSET_MANIFEST_PATH",
                    root / "config" / "template-assets.v1.json",
                ),
                patch.object(assets, "RUNTIME_REFERENCE_SOURCES", (source,)),
                patch.object(assets, "TOOLING_REFERENCE_SOURCES", ()),
                patch.object(assets, "ALWAYS_REQUIRED_BY_PURPOSE", {}),
            ):
                manifest, missing = assets.build_manifest()
            self.assertEqual(manifest["status"], "blocked")
            self.assertEqual(missing, ["missing.png"])
            self.assertEqual(
                manifest["missingAssets"], ["template-gallery/missing.png"]
            )

    def test_inventory_distinguishes_required_from_present_assets(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "template-gallery"
            gallery.mkdir()
            (gallery / "present.bin").write_bytes(b"present")
            source = root / "templates.ts"
            source.write_text(
                "'/template-gallery/present.bin'; '/template-gallery/missing.bin'",
                encoding="utf-8",
            )
            with (
                patch.object(assets, "CLIENT_ROOT", root),
                patch.object(assets, "GALLERY_ROOT", gallery),
                patch.object(assets, "RUNTIME_REFERENCE_SOURCES", (source,)),
                patch.object(assets, "TOOLING_REFERENCE_SOURCES", ()),
                patch.object(assets, "ALWAYS_REQUIRED_BY_PURPOSE", {}),
            ):
                manifest, _ = assets.build_manifest()
                output = io.StringIO()
                with redirect_stdout(output):
                    assets.print_inventory(manifest)

            self.assertIn("Required assets: 2", output.getvalue())
            self.assertIn("Present required assets: 1", output.getvalue())
            self.assertIn("Missing required assets: 1", output.getvalue())

    def test_path_traversal_is_rejected(self) -> None:
        with self.assertRaises(assets.AssetPipelineError):
            assets.normalized_relative_path("/template-gallery/../secret")

    def test_manifest_contract_rejects_noncanonical_cross_platform_paths(
        self,
    ) -> None:
        unsafe_paths = (
            "template-gallery/../outside.bin",
            "template-gallery//outside.bin",
            "template-gallery/C:outside.bin",
            "template-gallery/nested\\outside.bin",
            "template-gallery/CON.txt",
            "/template-gallery/outside.bin",
        )
        for unsafe_path in unsafe_paths:
            with self.subTest(path=unsafe_path):
                manifest = ready_manifest([asset_record(unsafe_path, b"unsafe")])
                remote_download = Mock()
                with (
                    patch.object(assets, "checked_manifest", return_value=manifest),
                    patch.object(assets, "remote_manifest", remote_download),
                ):
                    with self.assertRaises(assets.AssetPipelineError):
                        assets.assert_remote_manifest_matches(
                            "modiff-project/template-gallery",
                            "0123456789abcdef0123456789abcdef01234567",
                        )
                remote_download.assert_not_called()

    def test_css_and_html_gallery_references_are_scanned(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stylesheet = root / "styles.css"
            document = root / "index.html"
            stylesheet.write_text(
                ".poster { background: url('/template-gallery/css/poster.webp'); }",
                encoding="utf-8",
            )
            document.write_text(
                '<img src="/template-gallery/html/poster.webp">', encoding="utf-8"
            )
            self.assertEqual(
                assets.concrete_references(stylesheet), {"css/poster.webp"}
            )
            self.assertEqual(
                assets.concrete_references(document), {"html/poster.webp"}
            )
        self.assertIn(".css", assets.SOURCE_EXTENSIONS)
        self.assertIn(".html", assets.SOURCE_EXTENSIONS)
        self.assertIn(assets.CLIENT_ROOT / "index.html", assets.RUNTIME_REFERENCE_SOURCES)

    def test_artifact_paths_dynamic_paths_and_directories_are_not_public_asset_references(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.mjs"
            source.write_text(
                "\n".join(
                    [
                        "'artifacts/template-gallery/source-assets/private.webp'",
                        "'/template-gallery/${templateId}.webp'",
                        "'/template-gallery/runtime-inputs'",
                        "'public/template-gallery/inputs/required.png'",
                        "'template-gallery/inputs/bare.png'",
                    ]
                ),
                encoding="utf-8",
            )
            self.assertEqual(
                assets.concrete_references(source),
                {"inputs/bare.png", "inputs/required.png"},
            )

    def test_unaudited_generated_config_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            generated = root / "config" / "runtime.generated.yaml"
            generated.parent.mkdir()
            generated.write_text(
                "asset: template-gallery/generated/input.png\n", encoding="utf-8"
            )
            with (
                patch.object(assets, "CLIENT_ROOT", root),
                patch.object(
                    assets, "GALLERY_ROOT", root / "public" / "template-gallery"
                ),
                patch.object(
                    assets,
                    "ASSET_MANIFEST_PATH",
                    root / "config" / "template-assets.v1.json",
                ),
                patch.object(assets, "RUNTIME_REFERENCE_SOURCES", ()),
                patch.object(assets, "TOOLING_REFERENCE_SOURCES", ()),
                patch.object(assets, "ALWAYS_REQUIRED_BY_PURPOSE", {}),
            ):
                self.assertEqual(
                    assets.unaudited_durable_reference_sources(), [generated]
                )
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "not classified"
                ):
                    assets.required_assets_by_purpose()

    def test_every_durable_source_config_and_script_reference_is_classified(
        self,
    ) -> None:
        self.assertEqual(assets.unaudited_durable_reference_sources(), [])
        required = assets.required_assets_by_purpose()
        self.assertEqual(required["inputs/qwen-carton-layout-control.png"], {"tooling"})
        self.assertEqual(required["manifest.json"], {"runtime"})
        self.assertEqual(
            required["runtime-inputs/default-input-bindings.json"], {"tooling"}
        )

    def test_checked_in_manifest_contract_is_valid_without_local_asset_bytes(
        self,
    ) -> None:
        with patch.object(
            assets,
            "build_manifest",
            side_effect=AssertionError("contract validation must not read asset bytes"),
        ):
            manifest = assets.validate_checked_manifest_contract()
        self.assertEqual(manifest["schemaVersion"], 1)
        self.assertEqual(manifest["assetCount"], len(manifest["assets"]))
        self.assertEqual(
            manifest["status"], "blocked" if manifest["missingAssets"] else "ready"
        )

    def test_other_dataset_license_requires_name_and_text(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            card = root / "README.md"
            license_path = root / "LICENSE"
            card.write_text("---\nlicense: other\n---\n", encoding="utf-8")
            with (
                patch.object(assets, "DATASET_CARD_PATH", card),
                patch.object(assets, "DATASET_LICENSE_PATH", license_path),
            ):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "requires `license_name`"
                ):
                    assets.validate_dataset_licensing()

            card.write_text(
                "---\nlicense: other\nlicense_name: Reviewed Gallery Terms\n---\n",
                encoding="utf-8",
            )
            with (
                patch.object(assets, "DATASET_CARD_PATH", card),
                patch.object(assets, "DATASET_LICENSE_PATH", license_path),
            ):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "missing or empty"
                ):
                    assets.validate_dataset_licensing()
                license_path.write_text("Reviewed terms.\n", encoding="utf-8")
                assets.validate_dataset_licensing()

    def test_rights_ledger_is_exact_hash_bound_and_fail_closed(self) -> None:
        manifest = {
            "assetSetId": "sha256:canonical-json:test",
            "assets": [
                {
                    "path": "template-gallery/example.webp",
                    "sha256": "sha256:bytes:" + "a" * 64,
                }
            ],
        }
        with tempfile.TemporaryDirectory() as temporary:
            rights_path = Path(temporary) / "template-asset-rights.v1.json"
            with patch.object(assets, "ASSET_RIGHTS_PATH", rights_path):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "rights ledger is missing"
                ):
                    assets.validate_asset_rights(manifest)
                ledger = assets.build_rights_template(manifest)
                assets.write_json(rights_path, ledger)
                with self.assertRaisesRegex(assets.AssetPipelineError, "still holds 1"):
                    assets.validate_asset_rights(manifest)
                approved = ledger["records"][0]
                approved.update(
                    {
                        "publishDecision": "approved",
                        "creatorOrRightsholder": "Example rightsholder",
                        "creationMethod": "Original generation",
                        "sourceLicense": "not-applicable",
                        "modelTerms": ["Example model terms"],
                        "aiGenerated": True,
                        "humanLikenessConsent": "not-applicable",
                        "marks": [],
                        "requiredAttribution": [],
                        "assetLicense": "CC-BY-4.0",
                        "reviewedBy": "Example reviewer",
                        "reviewedAt": "2026-08-03",
                    }
                )
                assets.write_json(rights_path, ledger)
                self.assertEqual(assets.validate_asset_rights(manifest), ledger)
                ledger["records"][0]["sha256"] = "sha256:bytes:" + "b" * 64
                assets.write_json(rights_path, ledger)
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "hash does not match"
                ):
                    assets.validate_asset_rights(manifest)

    def test_rights_validation_rejects_placeholder_reviewer(self) -> None:
        payload = b"reviewed"
        manifest = ready_manifest(
            [asset_record("template-gallery/reviewed.bin", payload)]
        )
        ledger = assets.build_rights_template(manifest)
        ledger["records"][0].update(
            {
                "publishDecision": "approved",
                "holdReason": None,
                "creatorOrRightsholder": "Example rightsholder",
                "creationMethod": "Original generation",
                "sourceLicense": "not-applicable",
                "modelTerms": [],
                "aiGenerated": False,
                "humanLikenessConsent": "not-applicable",
                "marks": [],
                "requiredAttribution": [],
                "assetLicense": "Apache-2.0",
                "reviewedBy": "YOUR FULL NAME",
                "reviewedAt": "2026-08-03",
            }
        )
        with tempfile.TemporaryDirectory() as temporary:
            rights_path = Path(temporary) / "rights.json"
            assets.write_json(rights_path, ledger)
            with patch.object(assets, "ASSET_RIGHTS_PATH", rights_path):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "placeholder reviewer"
                ):
                    assets.validate_asset_rights(manifest)

    def test_upload_staging_uses_independent_verified_copies(self) -> None:
        payload = b"independent staged bytes"
        manifest = ready_manifest(
            [asset_record("template-gallery/nested/example.bin", payload)]
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "gallery"
            source = gallery / "nested" / "example.bin"
            source.parent.mkdir(parents=True)
            source.write_bytes(payload)
            checked_manifest = root / "template-assets.v1.json"
            checked_rights = root / "template-asset-rights.v1.json"
            card = root / "README.md"
            checked_manifest.write_text("{}\n", encoding="utf-8")
            checked_rights.write_text("{}\n", encoding="utf-8")
            card.write_text("---\nlicense: apache-2.0\n---\n", encoding="utf-8")
            staging = root / "staging"
            with (
                patch.object(assets, "GALLERY_ROOT", gallery),
                patch.object(assets, "ASSET_MANIFEST_PATH", checked_manifest),
                patch.object(assets, "ASSET_RIGHTS_PATH", checked_rights),
                patch.object(assets, "DATASET_CARD_PATH", card),
                patch.object(assets, "validate_dataset_licensing"),
                patch.object(assets, "validate_asset_rights"),
            ):
                assets.stage_upload(manifest, staging)
            staged = staging / "template-gallery" / "nested" / "example.bin"
            self.assertEqual(staged.read_bytes(), payload)
            self.assertFalse(source.samefile(staged))
            source.write_bytes(b"later local edit")
            self.assertEqual(staged.read_bytes(), payload)

    def test_upload_staging_rejects_bytes_changed_after_manifest_creation(self) -> None:
        manifest = ready_manifest(
            [asset_record("template-gallery/example.bin", b"expected")]
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "gallery"
            gallery.mkdir()
            (gallery / "example.bin").write_bytes(b"modified")
            checked_manifest = root / "template-assets.v1.json"
            checked_rights = root / "template-asset-rights.v1.json"
            card = root / "README.md"
            checked_manifest.write_text("{}\n", encoding="utf-8")
            checked_rights.write_text("{}\n", encoding="utf-8")
            card.write_text("---\nlicense: apache-2.0\n---\n", encoding="utf-8")
            with (
                patch.object(assets, "GALLERY_ROOT", gallery),
                patch.object(assets, "ASSET_MANIFEST_PATH", checked_manifest),
                patch.object(assets, "ASSET_RIGHTS_PATH", checked_rights),
                patch.object(assets, "DATASET_CARD_PATH", card),
                patch.object(assets, "validate_dataset_licensing"),
                patch.object(assets, "validate_asset_rights"),
            ):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "hash mismatch"
                ):
                    assets.stage_upload(manifest, root / "staging")

    def test_provisional_staging_contains_only_approved_exact_bytes(self) -> None:
        approved_payload = b"approved"
        held_payload = b"held"
        manifest = ready_manifest(
            [
                asset_record("template-gallery/approved.bin", approved_payload),
                asset_record("template-gallery/held.bin", held_payload),
            ]
        )
        approved_record = {
            "path": "template-gallery/approved.bin",
            "sha256": manifest["assets"][0]["sha256"],
            "publishDecision": "approved",
        }
        held_record = {
            "path": "template-gallery/held.bin",
            "sha256": manifest["assets"][1]["sha256"],
            "publishDecision": "hold",
            "holdReason": "Permission pending.",
        }
        ledger = {
            "schemaVersion": 1,
            "assetSetId": manifest["assetSetId"],
            "records": [approved_record, held_record],
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "gallery"
            gallery.mkdir()
            (gallery / "approved.bin").write_bytes(approved_payload)
            (gallery / "held.bin").write_bytes(held_payload)
            card = root / "README.md"
            card.write_text("---\nlicense: other\n---\nDataset\n", encoding="utf-8")
            license_path = root / "LICENSE"
            license_path.write_text("mixed terms\n", encoding="utf-8")
            staging = root / "staging"
            with (
                patch.object(assets, "GALLERY_ROOT", gallery),
                patch.object(assets, "DATASET_CARD_PATH", card),
                patch.object(assets, "DATASET_LICENSE_PATH", license_path),
                patch.object(assets, "validate_dataset_licensing"),
                patch.object(
                    assets,
                    "validate_asset_rights",
                    return_value=ledger,
                ),
            ):
                provisional_manifest, provisional_ledger, held_paths = (
                    assets.stage_provisional_upload(manifest, staging)
                )

            self.assertEqual(held_paths, ["template-gallery/held.bin"])
            self.assertTrue(
                (staging / "template-gallery" / "approved.bin").is_file()
            )
            self.assertFalse((staging / "template-gallery" / "held.bin").exists())
            self.assertEqual(provisional_manifest["status"], "blocked")
            self.assertEqual(provisional_manifest["assetCount"], 1)
            self.assertEqual(
                provisional_manifest["missingAssets"],
                ["template-gallery/held.bin"],
            )
            self.assertEqual(provisional_ledger["records"], [approved_record])
            self.assertEqual(
                provisional_ledger["assetSetId"],
                provisional_manifest["assetSetId"],
            )
            self.assertIn(
                "must not be activated",
                (staging / "README.md").read_text(encoding="utf-8"),
            )

    def test_provisional_upload_cli_has_no_activate_option(self) -> None:
        parsed = assets.parser().parse_args(
            [
                "upload-provisional",
                "--repo-id",
                "modiff-project/template-gallery",
                "--public",
                "--confirm-redistribution-rights",
            ]
        )
        self.assertIs(parsed.handler, assets.command_upload_provisional)
        self.assertFalse(hasattr(parsed, "activate"))

    def test_upload_replaces_only_managed_dataset_prefixes(self) -> None:
        calls: list[dict[str, object]] = []
        remote_verification = Mock()

        class FakeApi:
            def upload_folder(self, **kwargs: object) -> SimpleNamespace:
                calls.append(kwargs)
                return SimpleNamespace(oid="0123456789abcdef0123456789abcdef01234567")

        arguments = SimpleNamespace(
            public=True,
            confirm_redistribution_rights=True,
            repo_id="modiff-project/template-gallery",
            create=False,
            make_public=False,
            activate=False,
        )
        with (
            patch.object(
                assets,
                "verify_checked_manifest",
                return_value={"assetSetId": "sha256:test"},
            ),
            patch.object(assets, "require_hub", return_value=(FakeApi, None, None)),
            patch.object(assets, "ensure_public_repo"),
            patch.object(assets, "stage_upload"),
            patch.object(assets, "validate_dataset_licensing"),
            patch.object(assets, "validate_asset_rights"),
            patch.object(
                assets, "verify_public_remote_snapshot", remote_verification
            ),
        ):
            with redirect_stdout(io.StringIO()):
                self.assertEqual(assets.command_upload(arguments), 0)

        self.assertEqual(len(calls), 1)
        self.assertEqual(
            calls[0]["delete_patterns"],
            ["template-gallery/**", "_modiff/**", "LICENSE"],
        )
        self.assertNotIn("README.md", calls[0]["delete_patterns"])
        self.assertNotIn(".gitattributes", calls[0]["delete_patterns"])
        remote_verification.assert_called_once_with(
            "modiff-project/template-gallery",
            "0123456789abcdef0123456789abcdef01234567",
            {"assetSetId": "sha256:test"},
        )

    def test_upload_validates_license_before_hub_access(self) -> None:
        arguments = SimpleNamespace(
            public=True,
            confirm_redistribution_rights=True,
            repo_id="modiff-project/template-gallery",
            create=True,
            make_public=False,
            activate=False,
        )
        hub = Mock()
        with (
            patch.object(
                assets,
                "verify_checked_manifest",
                return_value={"assetSetId": "sha256:test"},
            ),
            patch.object(
                assets,
                "validate_dataset_licensing",
                side_effect=assets.AssetPipelineError("license review required"),
            ),
            patch.object(assets, "validate_asset_rights"),
            patch.object(assets, "require_hub", hub),
        ):
            with self.assertRaisesRegex(
                assets.AssetPipelineError, "license review required"
            ):
                assets.command_upload(arguments)
        hub.assert_not_called()

    def test_prune_local_requires_explicit_confirmation_before_checks(self) -> None:
        checked_manifest = Mock()
        with patch.object(
            assets, "validate_checked_manifest_contract", checked_manifest
        ):
            with self.assertRaisesRegex(
                assets.AssetPipelineError, "--confirm-delete-local-assets"
            ):
                assets.command_prune_local(
                    SimpleNamespace(confirm_delete_local_assets=False)
                )
        checked_manifest.assert_not_called()

    def test_prune_local_requires_an_activated_pinned_remote_source(self) -> None:
        manifest = {"assetSetId": "sha256:canonical-json:test"}
        with tempfile.TemporaryDirectory() as temporary:
            source_path = Path(temporary) / "templateAssetSource.json"
            source_path.write_text(
                json.dumps(
                    {
                        "mode": "local",
                        "repoId": None,
                        "revision": None,
                        "assetSetId": None,
                    }
                ),
                encoding="utf-8",
            )
            with patch.object(assets, "SOURCE_CONFIG_PATH", source_path):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "mode `huggingface`"
                ):
                    assets.activated_remote_source(manifest)

                source_path.write_text(
                    json.dumps(
                        {
                            "mode": "huggingface",
                            "repoId": "modiff-project/template-gallery",
                            "revision": "main",
                            "assetSetId": manifest["assetSetId"],
                        }
                    ),
                    encoding="utf-8",
                )
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "40-character commit SHA"
                ):
                    assets.activated_remote_source(manifest)

    def test_public_snapshot_verification_is_full_and_unauthenticated(self) -> None:
        revision = "0123456789abcdef0123456789abcdef01234567"
        manifest = {"assets": [], "assetSetId": "sha256:canonical-json:test"}
        api = Mock()
        api.repo_info.return_value = SimpleNamespace(private=False)
        api_factory = Mock(return_value=api)
        snapshot_download = Mock(return_value="/verified/snapshot")
        materialized_verification = Mock()
        with (
            patch.object(
                assets, "assert_remote_manifest_matches", return_value=manifest
            ),
            patch.object(
                assets,
                "require_hub",
                return_value=(api_factory, None, snapshot_download),
            ),
            patch.object(
                assets, "verify_materialized_assets", materialized_verification
            ),
        ):
            self.assertEqual(
                assets.verify_public_remote_snapshot(
                    "modiff-project/template-gallery", revision, manifest
                ),
                Path("/verified/snapshot"),
            )
        api_factory.assert_called_once_with(token=False)
        api.repo_info.assert_called_once_with(
            repo_id="modiff-project/template-gallery",
            repo_type="dataset",
            revision=revision,
            token=False,
        )
        snapshot_download.assert_called_once_with(
            repo_id="modiff-project/template-gallery",
            repo_type="dataset",
            revision=revision,
            token=False,
            allow_patterns=["template-gallery/**", "_modiff/**"],
        )
        materialized_verification.assert_called_once_with(
            Path("/verified/snapshot"), manifest, reject_unexpected=True
        )

    def test_activation_writes_source_only_after_full_public_byte_verification(
        self,
    ) -> None:
        revision = "0123456789abcdef0123456789abcdef01234567"
        manifest = {
            "status": "ready",
            "missingAssets": [],
            "assetSetId": "sha256:canonical-json:test",
            "assets": [],
        }
        with tempfile.TemporaryDirectory() as temporary:
            source_path = Path(temporary) / "templateAssetSource.json"
            original = {
                "mode": "local",
                "repoId": None,
                "revision": None,
                "assetSetId": None,
            }
            source_path.write_text(json.dumps(original), encoding="utf-8")
            with (
                patch.object(assets, "SOURCE_CONFIG_PATH", source_path),
                patch.object(
                    assets,
                    "validate_checked_manifest_contract",
                    return_value=manifest,
                ),
                patch.object(
                    assets,
                    "verify_public_remote_snapshot",
                    side_effect=assets.AssetPipelineError("remote byte mismatch"),
                ),
            ):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "remote byte mismatch"
                ):
                    assets.activate_source(
                        "modiff-project/template-gallery", revision
                    )
            self.assertEqual(json.loads(source_path.read_text(encoding="utf-8")), original)

            remote_verification = Mock()
            with (
                patch.object(assets, "SOURCE_CONFIG_PATH", source_path),
                patch.object(
                    assets,
                    "validate_checked_manifest_contract",
                    return_value=manifest,
                ),
                patch.object(
                    assets,
                    "verify_public_remote_snapshot",
                    remote_verification,
                ),
                redirect_stdout(io.StringIO()),
            ):
                assets.activate_source("modiff-project/template-gallery", revision)
            remote_verification.assert_called_once_with(
                "modiff-project/template-gallery", revision, manifest
            )
            activated = json.loads(source_path.read_text(encoding="utf-8"))
            self.assertEqual(activated["mode"], "huggingface")
            self.assertEqual(activated["revision"], revision)

    def test_prune_local_verifies_remote_before_any_deletion(self) -> None:
        revision = "0123456789abcdef0123456789abcdef01234567"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "public" / "template-gallery"
            gallery.mkdir(parents=True)
            candidate = gallery / "candidate.bin"
            candidate.write_bytes(b"candidate")
            manifest = {
                "status": "ready",
                "missingAssets": [],
                "assetSetId": "sha256:canonical-json:test",
                "assets": [
                    {
                        "path": "template-gallery/candidate.bin",
                        "size": candidate.stat().st_size,
                        "sha256": f"sha256:bytes:{assets.sha256_file(candidate)}",
                    }
                ],
            }
            source_path = root / "templateAssetSource.json"
            source_path.write_text(
                json.dumps(
                    {
                        "mode": "huggingface",
                        "repoId": "modiff-project/template-gallery",
                        "revision": revision,
                        "assetSetId": manifest["assetSetId"],
                    }
                ),
                encoding="utf-8",
            )
            with (
                patch.object(assets, "CLIENT_ROOT", root),
                patch.object(assets, "GALLERY_ROOT", gallery),
                patch.object(assets, "SOURCE_CONFIG_PATH", source_path),
                patch.object(
                    assets, "validate_checked_manifest_contract", return_value=manifest
                ),
                patch.object(
                    assets,
                    "verify_public_remote_snapshot",
                    side_effect=assets.AssetPipelineError("remote unavailable"),
                ),
            ):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "remote unavailable"
                ):
                    assets.command_prune_local(
                        SimpleNamespace(confirm_delete_local_assets=True)
                    )
            self.assertEqual(candidate.read_bytes(), b"candidate")

    def test_prune_local_deletes_only_exact_manifest_files(self) -> None:
        revision = "0123456789abcdef0123456789abcdef01234567"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "public" / "template-gallery"
            nested_candidate = gallery / "outputs" / "nested" / "candidate.bin"
            sibling_candidate = gallery / "candidate.bin"
            unlisted = gallery / "unlisted" / "keep.bin"
            retained_manifest = gallery / "manifest.json"
            retained_bindings = (
                gallery / "runtime-inputs" / "default-input-bindings.json"
            )
            for path, payload in (
                (nested_candidate, b"nested"),
                (sibling_candidate, b"sibling"),
                (unlisted, b"unlisted"),
                (retained_manifest, b"manifest"),
                (retained_bindings, b"bindings"),
            ):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(payload)

            def record(path: Path) -> dict[str, object]:
                relative_path = path.relative_to(gallery).as_posix()
                return {
                    "path": f"template-gallery/{relative_path}",
                    "size": path.stat().st_size,
                    "sha256": f"sha256:bytes:{assets.sha256_file(path)}",
                }

            manifest = {
                "status": "ready",
                "missingAssets": [],
                "assetSetId": "sha256:canonical-json:test",
                "assets": [
                    record(sibling_candidate),
                    record(retained_manifest),
                    record(nested_candidate),
                    record(retained_bindings),
                ],
            }
            source_path = root / "templateAssetSource.json"
            source_path.write_text(
                json.dumps(
                    {
                        "mode": "huggingface",
                        "repoId": "modiff-project/template-gallery",
                        "revision": revision,
                        "assetSetId": manifest["assetSetId"],
                    }
                ),
                encoding="utf-8",
            )
            remote_verification = Mock()
            with (
                patch.object(assets, "CLIENT_ROOT", root),
                patch.object(assets, "GALLERY_ROOT", gallery),
                patch.object(assets, "SOURCE_CONFIG_PATH", source_path),
                patch.object(
                    assets, "validate_checked_manifest_contract", return_value=manifest
                ),
                patch.object(
                    assets, "verify_public_remote_snapshot", remote_verification
                ),
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(
                    assets.command_prune_local(
                        SimpleNamespace(confirm_delete_local_assets=True)
                    ),
                    0,
                )

            remote_verification.assert_called_once_with(
                "modiff-project/template-gallery", revision, manifest
            )
            self.assertFalse(sibling_candidate.exists())
            self.assertFalse(nested_candidate.exists())
            self.assertFalse((gallery / "outputs").exists())
            self.assertEqual(unlisted.read_bytes(), b"unlisted")
            self.assertEqual(retained_manifest.read_bytes(), b"manifest")
            self.assertEqual(retained_bindings.read_bytes(), b"bindings")

    def test_prune_preflight_rejects_traversal_and_symlinks_without_deleting(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "template-gallery"
            gallery.mkdir()
            safe = gallery / "safe.bin"
            safe.write_bytes(b"safe")
            outside = root / "outside.bin"
            outside.write_bytes(b"outside")
            linked = gallery / "linked.bin"
            self.create_symlink_or_skip(linked, outside)
            safe_record = {
                "path": "template-gallery/safe.bin",
                "size": safe.stat().st_size,
                "sha256": f"sha256:bytes:{assets.sha256_file(safe)}",
            }
            with (
                patch.object(assets, "CLIENT_ROOT", root),
                patch.object(assets, "GALLERY_ROOT", gallery),
            ):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "Unsafe or non-canonical asset path"
                ):
                    assets.local_prune_targets(
                        {
                            "assets": [
                                safe_record,
                                {
                                    "path": "template-gallery/../outside.bin",
                                    "size": outside.stat().st_size,
                                    "sha256": f"sha256:bytes:{assets.sha256_file(outside)}",
                                },
                            ]
                        }
                    )
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "links or reparse"
                ):
                    assets.local_prune_targets(
                        {
                            "assets": [
                                safe_record,
                                {
                                    "path": "template-gallery/linked.bin",
                                    "size": outside.stat().st_size,
                                    "sha256": f"sha256:bytes:{assets.sha256_file(outside)}",
                                },
                            ]
                        }
                    )
            self.assertEqual(safe.read_bytes(), b"safe")
            self.assertEqual(outside.read_bytes(), b"outside")
            self.assertTrue(linked.is_symlink())

    def test_prune_preflight_rejects_a_symlinked_gallery_ancestor(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            outside = root / "outside"
            gallery = outside / "template-gallery"
            gallery.mkdir(parents=True)
            candidate = gallery / "candidate.bin"
            candidate.write_bytes(b"candidate")
            self.create_symlink_or_skip(
                root / "public", outside, target_is_directory=True
            )
            record = {
                "path": "template-gallery/candidate.bin",
                "size": candidate.stat().st_size,
                "sha256": f"sha256:bytes:{assets.sha256_file(candidate)}",
            }
            with (
                patch.object(assets, "CLIENT_ROOT", root),
                patch.object(
                    assets, "GALLERY_ROOT", root / "public" / "template-gallery"
                ),
            ):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "must not contain links or reparse"
                ):
                    assets.local_prune_targets({"assets": [record]})
            self.assertEqual(candidate.read_bytes(), b"candidate")

    def test_prune_preflight_rejects_a_junction_or_reparse_ancestor(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "public" / "template-gallery"
            nested = gallery / "nested"
            nested.mkdir(parents=True)
            candidate = nested / "candidate.bin"
            candidate.write_bytes(b"candidate")
            record = {
                "path": "template-gallery/nested/candidate.bin",
                "size": candidate.stat().st_size,
                "sha256": f"sha256:bytes:{assets.sha256_file(candidate)}",
            }
            real_detector = assets.path_is_link_or_reparse_point

            def detect_reparse(path: Path) -> bool:
                return path == nested or real_detector(path)

            with (
                patch.object(assets, "CLIENT_ROOT", root),
                patch.object(assets, "GALLERY_ROOT", gallery),
                patch.object(
                    assets,
                    "path_is_link_or_reparse_point",
                    side_effect=detect_reparse,
                ),
            ):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "links or reparse"
                ):
                    assets.local_prune_targets({"assets": [record]})
            self.assertEqual(candidate.read_bytes(), b"candidate")

    def test_prune_rechecks_hash_immediately_before_unlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "public" / "template-gallery"
            gallery.mkdir(parents=True)
            candidate = gallery / "candidate.bin"
            candidate.write_bytes(b"before")
            manifest = {
                "assets": [
                    {
                        "path": "template-gallery/candidate.bin",
                        "size": candidate.stat().st_size,
                        "sha256": f"sha256:bytes:{assets.sha256_file(candidate)}",
                    }
                ]
            }
            with (
                patch.object(assets, "CLIENT_ROOT", root),
                patch.object(assets, "GALLERY_ROOT", gallery),
            ):
                targets = assets.local_prune_targets(manifest)
                candidate.write_bytes(b"mutate")
                with self.assertRaisesRegex(
                    assets.AssetPipelineError,
                    r"changed after preflight \(hash mismatch\)",
                ):
                    assets.prune_exact_local_assets(targets)
            self.assertEqual(candidate.read_bytes(), b"mutate")

    def test_prune_rechecks_file_identity_immediately_before_unlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gallery = root / "public" / "template-gallery"
            gallery.mkdir(parents=True)
            candidate = gallery / "candidate.bin"
            candidate.write_bytes(b"same bytes")
            manifest = {
                "assets": [
                    {
                        "path": "template-gallery/candidate.bin",
                        "size": candidate.stat().st_size,
                        "sha256": f"sha256:bytes:{assets.sha256_file(candidate)}",
                    }
                ]
            }
            with (
                patch.object(assets, "CLIENT_ROOT", root),
                patch.object(assets, "GALLERY_ROOT", gallery),
            ):
                targets = assets.local_prune_targets(manifest)
                original_inspector = assets.inspect_regular_file
                calls = 0

                def replace_after_hash(
                    path: Path, *, context: str
                ) -> tuple[object, str]:
                    nonlocal calls
                    result = original_inspector(path, context=context)
                    calls += 1
                    if calls == 1:
                        replacement = path.with_suffix(".replacement")
                        replacement.write_bytes(b"same bytes")
                        replacement.replace(path)
                    return result

                with patch.object(
                    assets, "inspect_regular_file", side_effect=replace_after_hash
                ):
                    with self.assertRaisesRegex(
                        assets.AssetPipelineError,
                        "changed immediately before unlink",
                    ):
                        assets.prune_exact_local_assets(targets)
            self.assertEqual(candidate.read_bytes(), b"same bytes")

    def test_full_remote_verification_rejects_stale_managed_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            expected = root / "template-gallery" / "expected.bin"
            expected.parent.mkdir(parents=True)
            expected.write_bytes(b"expected")
            storage_manifest = root / "_modiff" / "template-assets.v1.json"
            storage_manifest.parent.mkdir()
            storage_manifest.write_text("{}\n", encoding="utf-8")
            (root / "template-gallery" / "stale.bin").write_bytes(b"stale")
            manifest = {
                "assets": [
                    {
                        "path": "template-gallery/expected.bin",
                        "size": len(b"expected"),
                        "sha256": f"sha256:bytes:{assets.sha256_file(expected)}",
                    }
                ]
            }
            with self.assertRaisesRegex(
                assets.AssetPipelineError, "unexpected managed file.*stale.bin"
            ):
                assets.verify_materialized_assets(
                    root, manifest, reject_unexpected=True
                )

    def test_download_copies_cache_bytes_without_hardlinks(self) -> None:
        revision = "0123456789abcdef0123456789abcdef01234567"
        payload = b"remote asset"
        manifest = ready_manifest(
            [asset_record("template-gallery/example.bin", payload)]
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            snapshot = root / "snapshot"
            cached_asset = snapshot / "template-gallery" / "example.bin"
            cached_asset.parent.mkdir(parents=True)
            cached_asset.write_bytes(payload)
            source_config = root / "templateAssetSource.json"
            source_config.write_text("{}\n", encoding="utf-8")
            destination = root / "destination"
            snapshot_download = Mock(return_value=str(snapshot))
            with (
                patch.object(assets, "SOURCE_CONFIG_PATH", source_config),
                patch.object(
                    assets, "assert_remote_manifest_matches", return_value=manifest
                ),
                patch.object(
                    assets,
                    "require_hub",
                    return_value=(None, None, snapshot_download),
                ),
                redirect_stdout(io.StringIO()),
            ):
                assets.command_download(
                    SimpleNamespace(
                        repo_id="modiff-project/template-gallery",
                        revision=revision,
                        destination=str(destination),
                        replace=False,
                    )
                )
            restored = destination / "template-gallery" / "example.bin"
            self.assertEqual(restored.read_bytes(), payload)
            self.assertFalse(cached_asset.samefile(restored))
            restored.write_bytes(b"local edit")
            self.assertEqual(cached_asset.read_bytes(), payload)

    def test_failed_atomic_download_preserves_existing_asset(self) -> None:
        revision = "0123456789abcdef0123456789abcdef01234567"
        payload = b"remote replacement"
        manifest = ready_manifest(
            [asset_record("template-gallery/example.bin", payload)]
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            snapshot = root / "snapshot"
            cached_asset = snapshot / "template-gallery" / "example.bin"
            cached_asset.parent.mkdir(parents=True)
            cached_asset.write_bytes(payload)
            source_config = root / "templateAssetSource.json"
            source_config.write_text("{}\n", encoding="utf-8")
            destination = root / "destination"
            existing = destination / "template-gallery" / "example.bin"
            existing.parent.mkdir(parents=True)
            existing.write_bytes(b"keep this old asset")

            def fail_copy(source: object, target: object, length: int) -> None:
                target.write(b"partial")
                raise OSError("simulated disk failure")

            with (
                patch.object(assets, "SOURCE_CONFIG_PATH", source_config),
                patch.object(
                    assets, "assert_remote_manifest_matches", return_value=manifest
                ),
                patch.object(
                    assets,
                    "require_hub",
                    return_value=(None, None, Mock(return_value=str(snapshot))),
                ),
                patch.object(assets.shutil, "copyfileobj", side_effect=fail_copy),
            ):
                with self.assertRaisesRegex(
                    assets.AssetPipelineError, "simulated disk failure"
                ):
                    assets.command_download(
                        SimpleNamespace(
                            repo_id="modiff-project/template-gallery",
                            revision=revision,
                            destination=str(destination),
                            replace=True,
                        )
                    )
            self.assertEqual(existing.read_bytes(), b"keep this old asset")
            self.assertEqual(list(existing.parent.glob(".example.bin.*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
