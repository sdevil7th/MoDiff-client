"""Read the exact registered catalog for browser authoring tests; no models."""

import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "MoDiff"))

from modiff.huggingface_node_library import reviewed_huggingface_node_library
from modiff.registered_block_v2_catalog import registered_block_v2_catalog_entry

entries = [
    registered_block_v2_catalog_entry(
        f"diffusers.modular:{pipeline}:text2image",
        f"diffusers.cluster-admission:{pipeline}:text2image:mode:text_to_image",
    )
    for pipeline in ("QwenImageModularPipeline", "FluxModularPipeline")
]
assert all(entries)
library = reviewed_huggingface_node_library()
assert not any(name in sys.modules for name in ("torch", "diffusers", "transformers"))
json.dump({"library": library, "entries": entries}, sys.stdout)
