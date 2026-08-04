export type DeviceReference = { path: string; device: string };

const DEVICE_PATTERN = /^(?:cuda|mps|cpu)(?::\d+)?$/i;
const DEVICE_PARAM_NAMES = new Set(['device']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function deviceParamEntries(value: unknown, path: string) {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([paramName, param]) => {
    if (!DEVICE_PARAM_NAMES.has(paramName.toLowerCase()) || !isRecord(param)) return [];
    return ['value', 'default'].flatMap((field) => {
      const device = param[field];
      return typeof device === 'string' && DEVICE_PATTERN.test(device)
        ? [{ path: `${path}.${paramName}.${field}`, device }]
        : [];
    });
  });
}

export function inspectGraphDeviceReferences(graph: unknown): DeviceReference[] {
  const found: DeviceReference[] = [];
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    Object.entries(value).forEach(([key, item]) => {
      const itemPath = path ? `${path}.${key}` : key;
      if (key === 'params') found.push(...deviceParamEntries(item, itemPath));
      visit(item, itemPath);
    });
  };
  visit(graph, '');
  return found;
}

export function unavailableGraphDevices(graph: unknown, availableDevices: readonly string[]) {
  const available = new Set(availableDevices.map((item) => item.toLowerCase()));
  return inspectGraphDeviceReferences(graph).filter(({ device }) => !available.has(device.toLowerCase()));
}

export function rebaseGraphDevices<T>(graph: T, targetDevice: string): T {
  const rebaseParams = (value: unknown): unknown => {
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([paramName, param]) => {
        if (!DEVICE_PARAM_NAMES.has(paramName.toLowerCase()) || !isRecord(param)) {
          return [paramName, visit(param)];
        }
        return [
          paramName,
          Object.fromEntries(
            Object.entries(param).map(([key, item]) => [
              key,
              (key === 'value' || key === 'default') && typeof item === 'string' && DEVICE_PATTERN.test(item)
                ? targetDevice
                : visit(item),
            ]),
          ),
        ];
      }),
    );
  };
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (isRecord(value))
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, key === 'params' ? rebaseParams(item) : visit(item)]),
      );
    return value;
  };
  return visit(graph) as T;
}
