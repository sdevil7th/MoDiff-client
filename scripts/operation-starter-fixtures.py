"""Fresh backend-owned operation schemas for native authoring tests; no weights."""

import contextlib
import io
import json
import re
import sys
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "MoDiff"))

from modiff.custom_extensions import ExtensionStore

# Starter fixtures cover built-in contracts, not the operator's approved code.
with contextlib.redirect_stdout(io.StringIO()), patch.object(ExtensionStore, "load_enabled", return_value=None):
    from modules import MODULE_MAP
    assert not any(key.startswith("custom.") for key in MODULE_MAP)
    from modiff.operation_catalog import build_operation_catalog
    from modiff.operation_contracts import operation_owns_model
    from modiff.operation_starters import resolve_operation_starter
    from modiff.server import WebServer

    contracts, _ = build_operation_catalog(MODULE_MAP, [], catalog_resolver=lambda: {})
    # Only the pure schema describer is used. Never construct a server/queue.
    describer = object.__new__(WebServer)
    results = []
    with patch("modiff.NodeBase.NodeBase.__init__", side_effect=AssertionError("Constructed node")):
        selections = (
            ("QwenImageModularPipeline", "text_to_image"),
            ("FluxModularPipeline", "text_to_image"),
            ("FluxModularPipeline", "image_to_image"),
            ("FluxKontextModularPipeline", "edit_image"),
            ("AnimaModularPipeline", "text_to_image"),
            ("StableAudioPipeline", "text_to_audio"),
            ("AceStepPipeline", "text_to_audio"),
            ("AceStepPipeline", "audio_variation"),
            ("SpandrelImageUpscaleV1", "image_upscale"),
            ("StableDiffusionXLModularPipeline", "text_to_image"),
            ("StableDiffusionXLModularPipeline", "image_to_image"),
            ("StableDiffusionXLModularPipeline", "inpaint"),
            ("QwenImageEditPlusModularPipeline", "multi_image_reference_edit"),
        )
        if "--image-audio" in sys.argv:
            selections = sorted({(c["pipelineClass"], c["task"]) for c in contracts if c["task"]
                                 and operation_owns_model(c)
                                 and not ("video" in c["task"] or c["task"] == "flf2v"
                                          or "3d" in c["task"] or c["task"].startswith("character_"))
                                 and re.search(r"image|inpaint|outpaint|controlnet|ip_adapter|depth|layer_decomposition|audio|speech|music", c["task"])})
        elif "--all-models" in sys.argv:
            selections = sorted({(c["pipelineClass"], c["task"]) for c in contracts if c["task"]
                                 and operation_owns_model(c)})
        elif "--all" in sys.argv:
            selections = sorted({(c["pipelineClass"], c["task"]) for c in contracts if c["task"]
                                 and (c["nodeKey"].startswith("modules.ModularDiffusers.")
                                      or c["decomposition"] == "integrated")})
        for pipeline, task in selections:
            result = resolve_operation_starter(MODULE_MAP, contracts, {"pipelineClass": pipeline, "task": task})
            result["nodes"] = [
                {
                    "operation": node["operation"],
                    "node": describer._describe_registered_node(node["module"], node["action"], node),
                }
                for node in result["nodes"]
            ]
            results.append(result)
json.dump(results, sys.stdout)
