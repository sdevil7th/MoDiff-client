/** File discovery is not execution, identity, quality or publication qualification. */
export function relatedWorkflowEvidencePaths(evidenceText, identities) {
  const wanted = new Set(identities);
  return [...evidenceText].flatMap(([path, text]) => {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return [];
    }
    const pending = [value];
    let remaining = 250_000;
    while (pending.length && remaining-- > 0) {
      const item = pending.pop();
      if (typeof item === 'string' && wanted.has(item)) return [path];
      const children = Array.isArray(item) ? item : item && typeof item === 'object' ? Object.values(item) : [];
      const limit = Math.min(children.length, remaining - pending.length);
      for (let index = 0; index < limit; index += 1) pending.push(children[index]);
    }
    return [];
  });
}
