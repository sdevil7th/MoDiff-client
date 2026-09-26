import type { NodeParams } from '../stores/useNodeStore';

/** A declared scalar input can keep its literal editor alongside its socket. */
export function hasInlineScalarControl(param: NodeParams) {
  if (!param.isInput || param.display === 'input' || param.display === 'output') return false;
  const types = Array.isArray(param.type) ? param.type : [param.type];
  return (
    types.length > 0 &&
    types.every(
      (type) =>
        typeof type === 'string' &&
        ['string', 'str', 'text', 'int', 'integer', 'float', 'number', 'double', 'bool', 'boolean'].includes(
          type.toLowerCase(),
        ),
    )
  );
}
