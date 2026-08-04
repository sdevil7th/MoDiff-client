import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderSemanticTokenCss } from './theme-token-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'src', 'theme', 'semanticTokens.json');
const outputPath = path.join(root, 'src', 'theme', 'semantic-tokens.generated.css');
const expected = renderSemanticTokenCss(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  if (current !== expected) {
    console.error('Generated theme tokens are stale. Run `npm run theme:tokens`.');
    process.exit(1);
  }
  console.log('Generated theme tokens match the canonical token artifact.');
} else {
  fs.writeFileSync(outputPath, expected, 'utf8');
  console.log(`Wrote ${path.relative(root, outputPath)}.`);
}
