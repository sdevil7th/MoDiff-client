"""Pure, selected backend schemas for image-template authoring tests; no weights."""

import contextlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, os.environ.get("MODIFF_BACKEND_DIR", str(Path(__file__).resolve().parents[2] / "MoDiff")))
selections = json.load(sys.stdin)
mock_cuda = "--mock-cuda" in sys.argv[1:]

with tempfile.TemporaryDirectory(prefix="modiff-template-schema-") as temporary:
    isolated = Path(temporary)
    os.environ["MODIFF_MANAGED_ROOT"] = str(isolated / "managed")
    os.environ["HF_HUB_OFFLINE"] = "1"
    from modiff import secret_config

    # Import the configuration with no operator config/token or directory writes.
    with patch("configparser.ConfigParser.read", return_value=[]), patch("os.makedirs"), \
            patch.object(secret_config, "huggingface_token", return_value=(None, None)):
        from modiff.config import CONFIG
    for key in CONFIG.paths:
        if key != "app_root":
            CONFIG.paths[key] = str(isolated / key)
            Path(CONFIG.paths[key]).mkdir(parents=True, exist_ok=True)
    CONFIG.hf["cache_dir"] = str(isolated / "hub")

    from modiff.custom_extensions import ExtensionStore
    from modiff import hardware

    # Transport tests may describe a CUDA-equipped host without probing or
    # constructing a GPU runtime. The ordinary schema and option describers
    # still derive all fields; this supplies only their hardware boundary.
    fixture_devices = [{
        "type": "cuda", "device": "cuda:0", "index": 0,
        "name": "Mock CUDA transport device", "backend": "cuda",
        "vendor": "nvidia", "memory_kind": "dedicated", "vram_total": 16 * 1024**3,
    }, {"type": "cpu", "device": "cpu:0", "index": 0}] if mock_cuda else None

    with contextlib.ExitStack() as patches, contextlib.redirect_stdout(io.StringIO()):
        patches.enter_context(patch.object(ExtensionStore, "load_enabled", return_value=None))
        if fixture_devices is not None:
            patches.enter_context(patch.object(hardware, "get_normalized_devices", return_value=fixture_devices))
            import torch
            patches.enter_context(patch.object(torch.cuda, "is_bf16_supported", return_value=True))
        from modules import MODULE_MAP
        from modiff.operation_catalog import build_operation_catalog
        from modiff.operation_starters import resolve_operation_starter
        from modiff.server import WebServer, STUDIO_MODEL_CAPABILITIES
        from modiff.studio_execution_specs import studio_execution_spec_for_pair

        assert not any(key.startswith("custom.") for key in MODULE_MAP)
        contracts, _ = build_operation_catalog(MODULE_MAP, [], catalog_resolver=lambda: {})
        describer = object.__new__(WebServer)
        describer.modules = MODULE_MAP
        if fixture_devices is not None:
            describer._available_runtime_devices = lambda: ["cuda:0", "cpu", "cpu:0"]
        describer._optimization_runtime_context = lambda: (
            "schema-fixture", {"devices": fixture_devices or [], "platform": sys.platform},
            {"detected": "cuda" if mock_cuda else "cpu", "status": "ready", "execution_ready": True},
        )
        rows, registry, historical_cosmos_image = [], {}, None

        def describe(key):
            module, action = key.rsplit(".", 1)
            registry[key] = describer._describe_registered_node(module, action, MODULE_MAP[module][action])

        with patch("modiff.NodeBase.NodeBase.__init__", side_effect=AssertionError("Constructed executable node")):
            public_payload = describer._build_model_capabilities_payload()
            public_capabilities = public_payload["capabilities"]
            for item in selections:
                selection = item["selection"]
                starter = resolve_operation_starter(MODULE_MAP, contracts, {
                    "pipelineClass": selection["pipelineClass"],
                    "task": selection["task"],
                    **({"executionProfileId": selection["executionProfileId"]}
                       if "executionProfileId" in selection else {}),
                    **({"repository": selection["repository"]} if selection.get("repository") else {}),
                    **({"authoringRecipeId": selection["authoringRecipeId"]}
                       if selection.get("authoringRecipeId") else {}),
                })
                starter["nodes"] = [{
                    "operation": node["operation"],
                    "node": describer._describe_registered_node(node["module"], node["action"], node),
                } for node in starter["nodes"]]
                binding = selection.get("bindingSpec")
                spec = studio_execution_spec_for_pair(binding["modelType"], binding["mode"]) if binding else None
                if binding and spec is None:
                    raise ValueError(f"Missing template semantic bindings: {binding}")
                for node in starter["nodes"]:
                    describe(node["operation"]["nodeKey"])
                for _, key, _, _ in starter.get("authoring", spec or {"roles": []})["roles"]:
                    describe(key)
                rows.append({"id": item["id"], "starter": starter, "spec": spec,
                             "capability": STUDIO_MODEL_CAPABILITIES[binding["modelType"]] if binding else None})
            for key in ("modules.ImageOperations.ProcessImage", "modules.ModularDiffusers.Lora",
                        "modules.ModularDiffusers.QuantizationConfigNode",
                        "modules.DiffusersImage.LoadAdapter",
                        "modules.Spandrel.Upscaler", "modules.Image.Preview", "modules.Image.Resize",
                        "modules.Image.Save", "modules.ImageOperations.CropImage", "modules.ImageOperations.MaskComposite",
                        "modules.DiffusersImage.OutpaintCanvas", "modules.Audio.Export", "modules.Audio.Load", "modules.Image.Load",
                        "modules.DiffusersAudio.LoadAdapter"):
                describe(key)
            if any(item["selection"]["pipelineClass"] == "Cosmos3OmniModularPipeline" for item in selections):
                from modiff.modular_whole_workflow_contracts import (
                    PINNED_WHOLE_WORKFLOW_GRAPH_ADAPTERS, reviewed_whole_workflow_action_adapter,
                )

                # Retain an independent old image declaration for saved-graph
                # preservation tests. This patch is isolated to this schema-only
                # fixture process; the current public catalog remains unchanged.
                legacy_adapter = reviewed_whole_workflow_action_adapter(
                    "Cosmos3OmniModularPipeline", "text2image", "workflow_cosmos3_omni_after_decode",
                )
                with patch.dict(PINNED_WHOLE_WORKFLOW_GRAPH_ADAPTERS, {
                    ("Cosmos3OmniModularPipeline", "text2image"): legacy_adapter,
                }):
                    legacy_contracts, _ = build_operation_catalog(MODULE_MAP, [], catalog_resolver=lambda: {})
                    legacy_starter = resolve_operation_starter(MODULE_MAP, legacy_contracts, {
                        "pipelineClass": "Cosmos3OmniModularPipeline", "task": "text_to_image",
                        "executionProfileId": "cosmos3-super-text-to-image:official-modular-workflow",
                    })
                legacy_starter["nodes"] = [{
                    "operation": node["operation"],
                    "node": describer._describe_registered_node(node["module"], node["action"], node),
                } for node in legacy_starter["nodes"]]
                legacy_spec = studio_execution_spec_for_pair(
                    "Cosmos3OmniModularPipeline", "text_to_image", content_hash="studio-spec-v1-91ed105d",
                )
                for _, key, _, _ in legacy_spec["roles"]:
                    describe(key)
                historical_cosmos_image = {
                    "starter": legacy_starter, "spec": legacy_spec,
                    "operationContracts": [c for c in legacy_contracts
                                           if c["pipelineClass"] == "Cosmos3OmniModularPipeline"
                                           and c["task"] == "text_to_image"],
                }
    json.dump({"recipes": rows, "registry": registry, "capabilities": public_capabilities,
               "publicPayload": public_payload, "historicalCosmosImage": historical_cosmos_image}, sys.stdout)
