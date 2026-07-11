import { categoryColors } from './categoryColors';
import { modiffColors } from './designTokens';
import { normalizeDataType } from '../utils/dataTypeCategory';

export function generateCategoryStyles() {
  const styles: Record<string, Record<string, string>> = {};

  Object.entries(categoryColors).forEach(([category, color]) => {
    const categoryClass = `category-${normalizeDataType(category)}`;
    styles[
      `.react-flow__edge.${categoryClass} .react-flow__edge-path, .react-flow__edge.selected.${categoryClass} .react-flow__edge-path`
    ] = { stroke: color };
    styles[`li.${categoryClass}, .${categoryClass}>header, .react-flow__node.selected>.${categoryClass}`] = {
      borderColor: color,
      outlineColor: color,
    };
    styles[`.react-flow__handle.${normalizeDataType(category)}-handle, .react-flow__handle.${categoryClass}`] = {
      backgroundColor: color,
      borderColor: color,
    };
  });

  return styles;
}

export const reactFlowBaselineStyles = {
  '.react-flow__handle': {
    backgroundColor: modiffColors.flowHandle,
    outlineColor: modiffColors.flowHandleOutline,
  },
  ...generateCategoryStyles(),
};

export const reactFlowBaseCss = `
.react-flow__handle {
  --modiff-flow-handle-color: var(--color-hf-gray);
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-modiff-bg);
  border-radius: var(--radius-modiff-compact);
  background-color: var(--modiff-flow-handle-color);
  box-shadow: 0 0 0 1px var(--color-modiff-border);
  opacity: 0.88;
  transition: opacity 120ms ease, box-shadow 120ms ease, transform 120ms ease;
}

.react-flow__handle::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 24px;
  height: 24px;
  cursor: crosshair;
}

.react-flow__handle:hover,
.react-flow__handle.connectingfrom,
.react-flow__handle.connectingto,
.react-flow__handle.valid {
  box-shadow: 0 0 0 2px var(--modiff-flow-handle-color);
  opacity: 1;
  transform: scale(1.08);
}

.react-flow__handle-left {
  left: -6px;
}

.react-flow__handle-right {
  right: -6px;
}

.react-flow__connection-path {
  marker-end: url(#connection-marker);
  stroke: var(--color-hf-gray);
  stroke-width: 3;
  stroke-dasharray: 8,8;
}

.react-flow__edge .react-flow__edge-path {
  stroke: var(--modiff-flow-edge-color, var(--color-hf-gray));
  stroke-width: 3;
  stroke-opacity: 0.7;
  transition: stroke-opacity 120ms ease, stroke-width 120ms ease;
}

.react-flow__edge.selected .react-flow__edge-path,
.react-flow__edge:hover .react-flow__edge-path {
  stroke-opacity: 1;
  stroke-width: 3.5;
}

.react-flow__node.selected > [class*="category-"] {
  border-color: var(--modiff-flow-node-accent, var(--color-hf-yellow));
  outline-color: var(--modiff-flow-node-accent, var(--color-hf-yellow));
}

.react-flow.connecting * {
  cursor: crosshair !important;
}

.invalid-connection .react-flow__connection-path {
  stroke: var(--color-modiff-red);
}

.invalid-connection #connection-marker rect {
  fill: var(--color-modiff-red);
}

.valid-connection .react-flow__connection-path {
  stroke: var(--color-modiff-green);
}

.valid-connection #connection-marker rect {
  fill: var(--color-modiff-green);
}`;

export function generateReactFlowCategoryCss() {
  return Object.entries(categoryColors)
    .map(([category, color]) => {
      const normalized = normalizeDataType(category);
      const categoryClass = `category-${normalized}`;

      return `
.react-flow__edge.${categoryClass} {
  --modiff-flow-edge-color: ${color};
}

.react-flow__handle.${normalized}-handle,
.react-flow__handle.${categoryClass} {
  --modiff-flow-handle-color: ${color};
}

.react-flow__node.selected > .${categoryClass} {
  --modiff-flow-node-accent: ${color};
}`;
    })
    .join('\n');
}

export const reactFlowCategoryCss = generateReactFlowCategoryCss();

export const reactFlowCss = `${reactFlowBaseCss}\n${reactFlowCategoryCss}`;
