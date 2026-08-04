export function renderSemanticTokenCss(tokens) {
  const declarations = Object.entries(tokens.cssVariables)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join('\n');
  return `/* Generated from src/theme/semanticTokens.json. Do not edit directly. */\n@theme {\n${declarations}\n}\n`;
}
