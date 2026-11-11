import { createRoot } from 'react-dom/client';
import ModelSetupAdapterControls from '../../../src/components/ModelSetupAdapterControls';
import { useFlowStore } from '../../../src/stores/useFlowStore';

// eslint-disable-next-line react-refresh/only-export-components -- Isolated mounted-control test entry point.
function ModelSetupAdapterProbe({ nodeId }: { nodeId: string }) {
  const node = useFlowStore((state) => state.nodes.find((item) => item.id === nodeId)!);
  return (
    <section data-testid="mounted-model-setup-adapters">
      <ModelSetupAdapterControls
        node={node}
        updateStore={(param, value, key) => useFlowStore.getState().setParamWithHistory(nodeId, param, value, key)}
      />
    </section>
  );
}

export function mountModelSetupAdapterProbe(nodeId: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  createRoot(host).render(<ModelSetupAdapterProbe nodeId={nodeId} />);
}
