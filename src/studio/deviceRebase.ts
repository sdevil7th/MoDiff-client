export type DeviceReference = { path: string; device: string };

const DEVICE_PATTERN = /^(?:cuda|mps|cpu)(?::\d+)?$/i;

export function inspectGraphDeviceReferences(graph: unknown): DeviceReference[] {
  const found: DeviceReference[] = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value === 'string' && DEVICE_PATTERN.test(value)) found.push({ path, device: value });
    else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
    else if (typeof value === 'object' && value !== null) Object.entries(value).forEach(([key, item]) => visit(item, path ? `${path}.${key}` : key));
  };
  visit(graph, '');
  return found;
}

export function unavailableGraphDevices(graph: unknown, availableDevices: readonly string[]) {
  const available = new Set(availableDevices.map((item) => item.toLowerCase()));
  return inspectGraphDeviceReferences(graph).filter(({ device }) => !available.has(device.toLowerCase()));
}

export function rebaseGraphDevices<T>(graph: T, targetDevice: string): T {
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string' && DEVICE_PATTERN.test(value)) return targetDevice;
    if (Array.isArray(value)) return value.map(visit);
    if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  };
  return visit(graph) as T;
}
