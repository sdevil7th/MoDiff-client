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
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "MoDiff"))
selections = json.load(sys.stdin)

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

    with contextlib.redirect_stdout(io.StringIO()), patch.object(ExtensionStore, "load_enabled", return_value=None):
        from modules import MODULE_MAP
        from modiff.operation_catalog import build_operation_catalog
        from modiff.operation_starters import resolve_operation_starter
        from modiff.server import WebServer, STUDIO_MODEL_CAPABILITIES
        from modiff.studio_execution_specs import studio_execution_spec_for_pair

        assert not any(key.startswith("custom.") for key in MODULE_MAP)
        contracts, _ = build_operation_catalog(MODULE_MAP, [], catalog_resolver=lambda: {})
        describer = object.__new__(WebServer)
        describer.modules = MODULE_MAP
        describer._optimization_runtime_context = lambda: (
            "schema-fixture", {"devices": [], "platform": sys.platform},
            {"detected": "cpu", "status": "ready", "execution_ready": True},
        )
        rows, registry = [], {}

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
                    "executionProfileId": selection["executionProfileId"],
                })
                starter["nodes"] = [{
                    "operation": node["operation"],
                    "node": describer._describe_registered_node(node["module"], node["action"], node),
                } for node in starter["nodes"]]
                binding = selection["bindingSpec"]
                spec = studio_execution_spec_for_pair(binding["modelType"], binding["mode"])
                if spec is None:
                    raise ValueError(f"Missing template semantic bindings: {binding}")
                for _, key, _, _ in spec["roles"]:
                    describe(key)
                rows.append({"id": item["id"], "starter": starter, "spec": spec,
                             "capability": STUDIO_MODEL_CAPABILITIES[binding["modelType"]]})
            for key in ("modules.ModularDiffusers.Lora", "modules.DiffusersImage.LoadAdapter",
                        "modules.Spandrel.Upscaler", "modules.Image.Preview"):
                describe(key)
    json.dump({"recipes": rows, "registry": registry, "capabilities": public_capabilities,
               "publicPayload": public_payload}, sys.stdout)
