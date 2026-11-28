export const MAX_ORDERED_ADAPTERS = 8;

type AdapterChainEndpoint = { nodeId: string; handles: readonly string[] };
export type AdapterChainLink = {
  source: string;
  sourceHandles: string[];
  target: string;
  targetHandles: string[];
};
type AdapterChainOptions = {
  adapterIds: readonly string[];
  inputHandles: readonly string[];
  outputHandles: readonly string[];
  target: AdapterChainEndpoint;
  source?: AdapterChainEndpoint;
  maxOwnedAdapters?: number;
};

/** Port candidates and order only; callers own eligibility and graph transactions. */
export function orderedAdapterChainLinks({
  adapterIds,
  inputHandles,
  outputHandles,
  target,
  source,
  maxOwnedAdapters = MAX_ORDERED_ADAPTERS,
}: AdapterChainOptions): AdapterChainLink[] {
  if (!Number.isInteger(maxOwnedAdapters) || maxOwnedAdapters < 1 || maxOwnedAdapters > 32)
    throw new Error('An ordered adapter chain requires a bound from 1 through 32.');
  if (adapterIds.length > maxOwnedAdapters || new Set(adapterIds).size !== adapterIds.length)
    throw new Error(`An ordered adapter chain requires at most ${maxOwnedAdapters} distinct adapters.`);
  const links: AdapterChainLink[] = [];
  let previous = source;
  for (const nodeId of adapterIds) {
    if (previous)
      links.push({
        source: previous.nodeId,
        sourceHandles: [...previous.handles],
        target: nodeId,
        targetHandles: [...inputHandles],
      });
    previous = { nodeId, handles: outputHandles };
  }
  if (previous)
    links.push({
      source: previous.nodeId,
      sourceHandles: [...previous.handles],
      target: target.nodeId,
      targetHandles: [...target.handles],
    });
  return links;
}
