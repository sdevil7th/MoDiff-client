"""Regenerate the no-weight CTC insertion fixture from the paired backend."""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent / 'MoDiff'))

from modiff.huggingface_node_library import reviewed_huggingface_node_library
from modiff.registered_block_v2_catalog import registered_block_v2_catalog_entry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'tests/fixtures/ctc-catalog-insertion.v1.json')
    args = parser.parse_args()
    identity = 'transformers.composite:HuggingFaceCTCSpeechRecognitionModel:speech_to_text'
    definition = next(row for row in reviewed_huggingface_node_library()['definitions'] if row['id'] == identity)
    (admission,) = definition['executionAdmissions']
    entry = registered_block_v2_catalog_entry(identity, admission['id'])
    assert entry and entry['catalogDefinitionContentHash'] == definition['contentHash']
    result = {'schemaVersion': 1,
              'generatedFrom': 'modiff.huggingface_node_library and modiff.registered_block_v2_catalog; static contract, no model execution',
              'catalogDefinition': definition, 'compiledEntry': entry}
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print('Generated the CTC insertion fixture from the current paired contracts; no model execution.')


if __name__ == '__main__':
    main()
