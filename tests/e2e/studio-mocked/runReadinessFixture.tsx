import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import FileBrowserField from '../../../src/fields/FileBrowserField';
import { useFlowStore } from '../../../src/stores/useFlowStore';
import { useRunReadinessIssues } from '../../../src/studio/useRunReadinessIssues';

// eslint-disable-next-line react-refresh/only-export-components -- Isolated mounted-hook test entry point.
function ReadinessProbe() {
  const { issues } = useRunReadinessIssues({ sid: 'mock-sid', isConnected: true, includeStudio: false });
  const file = useFlowStore(
    (state) => state.nodes.find((node) => node.id === 'readiness-upload-source')!.data.params.file!,
  );
  return (
    <>
      <output data-testid="mounted-media-readiness">
        {JSON.stringify(issues.filter((issue) => issue.code === 'media_file_input_missing'))}
      </output>
      <section data-testid="readiness-upload-picker">
        <ReactFlowProvider>
          <FileBrowserField
            nodeId="readiness-upload-source"
            fieldKey="file"
            label="Source image"
            display="filebrowser"
            disabled={false}
            hidden={false}
            style={{}}
            value={file.value}
            default={file.default}
            options={file.options ?? []}
            dataType="str"
            fieldType="param"
            module="modules.Image"
            action="Load"
            fieldOptions={file.fieldOptions}
            updateStore={(key, value) =>
              useFlowStore.getState().setParamWithHistory('readiness-upload-source', key, value)
            }
          />
        </ReactFlowProvider>
      </section>
    </>
  );
}

export function mountRunReadinessProbe() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  createRoot(host).render(<ReadinessProbe />);
}
