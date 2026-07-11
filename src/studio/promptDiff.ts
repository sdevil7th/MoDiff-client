export type DiffToken = {
  text: string;
  kind: 'same' | 'added' | 'removed';
};

function tokenizePrompt(prompt: string) {
  return prompt.match(/\S+/g) || [];
}

export function buildPromptDiff(basePrompt: string, currentPrompt: string): DiffToken[] {
  const base = tokenizePrompt(basePrompt);
  const current = tokenizePrompt(currentPrompt);
  const table = Array.from({ length: base.length + 1 }, () => Array(current.length + 1).fill(0) as number[]);

  for (let i = base.length - 1; i >= 0; i -= 1) {
    for (let j = current.length - 1; j >= 0; j -= 1) {
      const baseToken = base[i] ?? '';
      const currentToken = current[j] ?? '';
      const row = table[i];
      if (!row) continue;
      row[j] =
        baseToken === currentToken
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const diff: DiffToken[] = [];
  let i = 0;
  let j = 0;

  while (i < base.length && j < current.length) {
    const baseToken = base[i] ?? '';
    const currentToken = current[j] ?? '';
    if (baseToken === currentToken) {
      diff.push({ text: currentToken, kind: 'same' });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      diff.push({ text: baseToken, kind: 'removed' });
      i += 1;
    } else {
      diff.push({ text: currentToken, kind: 'added' });
      j += 1;
    }
  }

  while (i < base.length) {
    diff.push({ text: base[i] ?? '', kind: 'removed' });
    i += 1;
  }

  while (j < current.length) {
    diff.push({ text: current[j] ?? '', kind: 'added' });
    j += 1;
  }

  return diff;
}
