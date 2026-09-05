import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) {
  throw new Error('Usage: node scripts/generate-registered-block-v2-catalog.mjs <route-audit.json> <output.json>');
}

const inputPath = path.resolve(inputArg);
const outputPath = path.resolve(outputArg);
const report = JSON.parse(await readFile(inputPath, 'utf8'));
if (report?.format !== 'modiff.registered-block-v2-route-candidates.v1' || !Array.isArray(report.existingPins)) {
  throw new Error('The route audit is not a registered Block V2 candidate report.');
}

const entries = report.existingPins
  .map((pin) => {
    if (
      !pin?.compiledDefinition ||
      !pin?.compiledValues ||
      !pin?.compiledInternalLayout ||
      typeof pin?.compiledDefinitionCanonicalSha256 !== 'string'
    ) {
      throw new Error(`Route ${pin?.definitionId ?? 'unknown'} did not include its complete compiled snapshot.`);
    }
    return {
      catalogDefinitionId: pin.definitionId,
      catalogDefinitionContentHash: pin.definitionContentHash,
      admissionId: pin.admissionId,
      compiledDefinitionCanonicalSha256: pin.compiledDefinitionCanonicalSha256,
      definition: pin.compiledDefinition,
      values: pin.compiledValues,
      internalLayout: pin.compiledInternalLayout,
      internalLayoutMode: pin.compiledInternalLayoutMode,
    };
  })
  .sort((left, right) =>
    `${left.catalogDefinitionId}\0${left.admissionId}`.localeCompare(
      `${right.catalogDefinitionId}\0${right.admissionId}`,
      'en',
    ),
  );

const duplicateKeys = entries
  .map((entry) => `${entry.catalogDefinitionId}\0${entry.admissionId}`)
  .filter((key, index, keys) => keys.indexOf(key) !== index);
if (duplicateKeys.length) throw new Error(`The route audit contains duplicate entries: ${duplicateKeys.join(', ')}`);

const payload = {
  schemaVersion: 1,
  format: 'modiff.registered-block-v2-compiled-catalog.v1',
  generatedBy: 'scripts/registered-block-v2-route-audit.test.mjs',
  entries,
};
// This is generated, hash-pinned data. Keep it compressed beside the backend
// contract loader rather than inflating the browser bundle with every graph.
const serialized = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
await writeFile(outputPath, outputPath.endsWith('.gz') ? gzipSync(serialized, { level: 9 }) : serialized);
process.stdout.write(`${entries.length} compiled BlockDefinitionV2 entries -> ${outputPath}\n`);
