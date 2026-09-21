"""Fresh backend-owned operation schemas for native authoring tests; no weights."""

import contextlib
import io
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "MoDiff"))

with contextlib.redirect_stdout(io.StringIO()):
    from modules import MODULE_MAP
    from modiff.operation_catalog import build_operation_catalog
    from modiff.operation_starters import resolve_operation_starter
    from modiff.server import WebServer

    contracts, _ = build_operation_catalog(MODULE_MAP, [], catalog_resolver=lambda: {})
    # Only the pure schema describer is used. Never construct a server/queue.
    describer = object.__new__(WebServer)
    results = []
    with patch("modiff.NodeBase.NodeBase.__init__", side_effect=AssertionError("Constructed node")):
        for pipeline, task in (
            ("QwenImageModularPipeline", "text_to_image"),
            ("FluxModularPipeline", "text_to_image"),
            ("FluxModularPipeline", "image_to_image"),
            ("FluxKontextModularPipeline", "edit_image"),
            ("AnimaModularPipeline", "text_to_image"),
            ("StableAudioPipeline", "text_to_audio"),
            ("StableDiffusionXLModularPipeline", "text_to_image"),
            ("StableDiffusionXLModularPipeline", "image_to_image"),
            ("StableDiffusionXLModularPipeline", "inpaint"),
            ("QwenImageEditPlusModularPipeline", "multi_image_reference_edit"),
        ):
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
