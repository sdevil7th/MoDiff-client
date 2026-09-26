import type { BlockInstanceV2 } from '../studio/blockSchemaV2';
import type { NodeParams } from '../stores/useNodeStore';
import type { OperationContract } from './operationContracts';
import type { PipelineSupport } from './operationCatalog';

// Lazy encoding ports materialize real stage endpoints on connection. Never save
// an edge to these handles or change execution merely because they are displayed.
export const OPTIONAL_ENCODING_IMAGE = 'modiff-encoding-input:image';
const OUTPUT_PREFIX = 'modiff-encoding-output:';
const INPUT_PREFIX = 'modiff-encoding-input:';
export function isOptionalEncodingHandle(handle: string | null | undefined) {
  return Boolean(handle?.startsWith(INPUT_PREFIX) || handle?.startsWith(OUTPUT_PREFIX));
}

type Capabilities = { operationContracts: OperationContract[]; pipelineSupport: PipelineSupport[] };
// Read through the existing registry. Keep pure graph helpers importable offline;
// importing a connector resolver must not initialize browser stores/networking.
let capabilities: () => Capabilities = () => ({ operationContracts: [], pipelineSupport: [] });
export function bindEncodingInputCapabilities(read: () => Capabilities) {
  capabilities = read;
}
export function currentOptionalEncodingPorts(instance: BlockInstanceV2 | undefined) {
  if (!instance) return {};
  const registry = capabilities();
  const previous = portsCache.get(instance);
  if (previous?.operations === registry.operationContracts && previous.support === registry.pipelineSupport)
    return previous.ports;
  const ports = optionalEncodingPorts(instance, registry.operationContracts, registry.pipelineSupport);
  portsCache.set(instance, { operations: registry.operationContracts, support: registry.pipelineSupport, ports });
  return ports;
}
let portsCache = new WeakMap<
  BlockInstanceV2,
  {
    operations: OperationContract[];
    support: PipelineSupport[];
    ports: Record<string, NodeParams>;
  }
>();

/** Loaded with capability discovery, before the registry is published. */
export let optionalEncodingRoute: typeof import('./encodingImageRoute').optionalEncodingRoute = () => null;
export function bindEncodingRouteResolver(resolve: typeof optionalEncodingRoute) {
  optionalEncodingRoute = resolve;
  portsCache = new WeakMap();
}

export function optionalEncodingPorts(
  instance: BlockInstanceV2 | undefined,
  operations: OperationContract[],
  support: PipelineSupport[],
): Record<string, NodeParams> {
  const operation = optionalEncodingRoute(instance, operations, support);
  if (!operation) return {};
  return Object.fromEntries(
    operation.ports
      .filter(
        (port) =>
          !port.hidden &&
          (port.direction === 'output' || port.semanticName === 'image' || port.roles.includes('component')),
      )
      .map((port) => [
        `${port.direction === 'input' ? INPUT_PREFIX : OUTPUT_PREFIX}${port.name ?? port.semanticName}`,
        {
          label:
            port.semanticName === 'vae'
              ? 'VAE'
              : port.semanticName.replace(/_/gu, ' ').replace(/\b\w/gu, (c) => c.toUpperCase()),
          type: port.types.length === 1 ? port.types[0] : port.types,
          display: port.direction,
          ...(port.direction === 'input' ? { isInput: true } : {}),
          ...(port.roles.includes('component') ? { signalCompatibility: { role: port.semanticName } } : {}),
          required: false,
          description: 'Connect to use image encoding. Unconnected optional ports do not change text-only execution.',
        } satisfies NodeParams,
      ]),
  );
}

export function optionalEncodingImageInput(
  instance: BlockInstanceV2 | undefined,
  operations: OperationContract[],
  support: PipelineSupport[],
): NodeParams | null {
  return optionalEncodingPorts(instance, operations, support)[OPTIONAL_ENCODING_IMAGE] ?? null;
}
