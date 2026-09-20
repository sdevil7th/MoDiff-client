import RuntimeNodeGroupsV2 from './RuntimeNodeGroupsV2';
// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useHuggingFaceModularConditionalStore } from '../stores/useHuggingFaceModularConditionalStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useUserBlockStore } from '../stores/useUserBlockStore';

import {
  Activity,
  Box as BoxIcon,
  Boxes,
  ChevronDown,
  CloudDownload,
  Filter,
  Image,
  LayoutGrid,
  LoaderCircle,
  Maximize,
  Trash2,
  Truck,
  Type,
  User,
  Webhook,
} from 'lucide-react';
import { cx } from '../utils/classNames';
import { matchesSearchKeywords } from '../utils/searchKeywords';
import {
  ModiffButton,
  ModiffCheckbox,
  ModiffDialog,
  ModiffFieldShell,
  ModiffInput,
  ModiffPopover,
  ModiffSearchInput,
  ModiffSelect,
  ModiffTabs,
  TreeButtonRow,
  TreeChildrenPanel,
} from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
import { createUserBlockFromSelection, createUserBlockNode, USER_BLOCK_DRAG_PREFIX } from '../studio/userBlocks';
import { createBlockInstanceV2 } from '../studio/blockSchemaV2';
import {
  isBlockDefinitionV2,
  storedUserBlockId,
  storedUserBlockName,
  storedUserBlockGroupPath,
  storedUserBlockRevision,
  uniqueStoredUserBlocks,
  type StoredUserBlockDefinition,
  type UserBlockGrouping,
} from '../studio/userBlockLibrary';
import { createBlockRootNodeV2 } from '../studio/blockRuntimeV2';
import { USER_BLOCK_V2_DRAG_PREFIX } from '../studio/blockPersistenceV2';
import {
  nodeGroupForCatalogEntry,
  nodeCatalogEntries,
  nodeCatalogEntryMatchesSearch,
  nodeCatalogEntryMatchesView,
  defaultNodeCatalogView,
  runtimeCatalogNodes,
  type NodeCatalogEntry,
  type NodeCatalogView,
} from '../studio/nodeCatalog';
import { createNodeFromRegistry } from '../workflow/nodeFactory';
import {
  buildHuggingFaceCatalogSections,
  filterHuggingFaceCatalogSections,
  type HuggingFaceCatalogEntry,
  type HuggingFaceCatalogSection,
} from '../studio/huggingFaceNodeCatalog';
import {
  HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
  HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
} from '../studio/huggingFaceClusterGraph';
import { HUGGING_FACE_CLUSTER_DRAG_PREFIX } from '../studio/huggingFaceClusterDrag';
import {
  beginBlockInsertionFeedbackV2,
  cancelBlockInsertionFeedbackV2,
  completeBlockInsertionFeedbackV2,
} from '../studio/blockInsertionFeedbackV2';
import { prepareWorkflowForManualInsertion } from '../studio/manualGraphInsertion';
import {
  executableCustomModularDependencies,
  inspectInstalledCustomModularContract,
  type CustomModularHubInspection,
} from '../studio/customModularHubImport';
import { formatRequestError } from '../utils/requestJson';
import {
  createModularDiffusersCatalogFragmentV2,
  createModularDiffusersCatalogNode,
  HUGGING_FACE_MODULAR_BLOCK_DRAG_PREFIX,
  modularDiffusersCatalogEntryHasDescendants,
} from '../studio/modularDiffusersBlockInsertion';

const CustomExtensionsPanel = lazy(() => import('./CustomExtensionsPanel'));
const OperationCatalogPanel = lazy(() => import('./OperationCatalogPanel'));

function NodeList() {
  const { hfDownloadProgress, installHfModel, nodesRegistry } = useNodesStore();
  const operationContracts = useNodesStore((state) => state.operationContracts);
  const pipelineSupport = useNodesStore((state) => state.pipelineSupport);
  const studioViewMode = useSettingsStore((state) => state.studioViewMode);
  const addNode = useFlowStore((state) => state.addNode);
  const viewport = useFlowStore((state) => state.viewport);
  const nodeCount = useFlowStore((state) => state.nodes.length);
  const userBlocks = useUserBlockStore((state) => state.blocks);
  const userBlockDefinitionsV2 = useUserBlockStore((state) => state.blockDefinitionsV2);
  const userBlocksLoaded = useUserBlockStore((state) => state.loaded);
  const fetchUserBlocks = useUserBlockStore((state) => state.fetchBlocks);
  const deleteUserBlock = useUserBlockStore((state) => state.deleteBlock);
  const saveUserBlock = useUserBlockStore((state) => state.saveBlock);
  const huggingFaceLibrary = useHuggingFaceNodeLibraryStore((state) => state.library);
  const modularConditionalSnapshot = useHuggingFaceModularConditionalStore((state) => state.snapshot);
  const modularConditionalSnapshotLoaded = useHuggingFaceModularConditionalStore((state) => state.loaded);
  const fetchModularConditionalSnapshot = useHuggingFaceModularConditionalStore((state) => state.fetchSnapshot);
  const studioForm = useStudioStore((state) => state.form);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const setWorkflowFocusRequest = useSettingsStore((state) => state.setWorkflowFocusRequest);
  const huggingFaceLibraryLoaded = useHuggingFaceNodeLibraryStore((state) => state.loaded);
  const huggingFaceLibraryError = useHuggingFaceNodeLibraryStore((state) => state.error);
  const fetchHuggingFaceLibrary = useHuggingFaceNodeLibraryStore((state) => state.fetchLibrary);
  const [search, setSearch] = useState('');
  const [blockContextMenu, setBlockContextMenu] = useState<{
    anchor: { left: number; top: number };
    block: StoredUserBlockDefinition;
  } | null>(null);
  const [blockPendingDelete, setBlockPendingDelete] = useState<StoredUserBlockDefinition | null>(null);
  const [hubImportOpen, setHubImportOpen] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [hubImportRepo, setHubImportRepo] = useState('');
  const [hubImportRevision, setHubImportRevision] = useState('');
  const [hubImportReviewed, setHubImportReviewed] = useState(false);
  const [hubImportBusy, setHubImportBusy] = useState(false);
  const [hubImportError, setHubImportError] = useState<string | null>(null);
  const [hubImportInspection, setHubImportInspection] = useState<CustomModularHubInspection | null>(null);
  const [clusterInsertionIds, setClusterInsertionIds] = useState<Set<string>>(() => new Set());
  const [catalogView, setCatalogView] = useState<NodeCatalogView>(defaultNodeCatalogView(studioViewMode));
  const expertMode = studioViewMode === 'expert';
  const effectiveCatalogView = expertMode ? catalogView : 'essential';
  const catalogNodes = useMemo(
    () => runtimeCatalogNodes(nodesRegistry, operationContracts, pipelineSupport, effectiveCatalogView),
    [effectiveCatalogView, nodesRegistry, operationContracts, pipelineSupport],
  );

  useEffect(() => {
    setCatalogView(defaultNodeCatalogView(studioViewMode));
  }, [studioViewMode]);

  useEffect(() => {
    if (!userBlocksLoaded) {
      void fetchUserBlocks();
    }
  }, [fetchUserBlocks, userBlocksLoaded]);

  useEffect(() => {
    if (!huggingFaceLibraryLoaded) {
      void fetchHuggingFaceLibrary();
    }
  }, [fetchHuggingFaceLibrary, huggingFaceLibraryLoaded]);

  useEffect(() => {
    if (!modularConditionalSnapshotLoaded) void fetchModularConditionalSnapshot();
  }, [fetchModularConditionalSnapshot, modularConditionalSnapshotLoaded]);

  const allHuggingFaceSections = useMemo(
    () => (huggingFaceLibrary ? buildHuggingFaceCatalogSections(huggingFaceLibrary, modularConditionalSnapshot) : []),
    [huggingFaceLibrary, modularConditionalSnapshot],
  );
  const huggingFaceSections = useMemo(
    () => filterHuggingFaceCatalogSections(allHuggingFaceSections, search, effectiveCatalogView),
    [allHuggingFaceSections, search, effectiveCatalogView],
  );
  const huggingFaceCatalogCount = useMemo(
    () =>
      filterHuggingFaceCatalogSections(allHuggingFaceSections, '', effectiveCatalogView).reduce(
        (total, section) => total + section.entries.length,
        0,
      ),
    [allHuggingFaceSections, effectiveCatalogView],
  );
  const runtimeNodeCount = useMemo(
    () =>
      nodeCatalogEntries(catalogNodes).filter((entry) => nodeCatalogEntryMatchesView(entry, effectiveCatalogView))
        .length,
    [catalogNodes, effectiveCatalogView],
  );

  const handleInsertUserBlock = useCallback(
    (block: StoredUserBlockDefinition) => {
      prepareWorkflowForManualInsertion();
      const position = collisionFreeInsertPosition(
        insertPositionForViewport(viewport, nodeCount),
        useFlowStore.getState().nodes,
        { width: 420, height: 480 },
      );
      const node = isBlockDefinitionV2(block)
        ? createBlockRootNodeV2(
            createBlockInstanceV2(block, {
              instanceId: `block-v2-${nanoid(16)}`,
              position,
              size: { width: 420, height: 480 },
            }),
          )
        : createUserBlockNode(block, position);
      addNode(node);
      if (activeWorkflowTabId) {
        const requestedAt = Date.now();
        setWorkflowFocusRequest({
          workflowTabId: activeWorkflowTabId,
          nodeId: node.id,
          requestId: requestedAt,
          requestedAt,
        });
      }
    },
    [activeWorkflowTabId, addNode, nodeCount, setWorkflowFocusRequest, viewport],
  );

  const handleInsertNode = useCallback(
    (key: string, definition?: NodeData) => {
      prepareWorkflowForManualInsertion();
      const node = createNodeFromRegistry(
        key,
        definition ? { [key]: definition } : nodesRegistry,
        insertPositionForViewport(viewport, nodeCount),
      );
      if (!node) {
        enqueueSnackbar(`Node ${key} is no longer available. Reload the node list and try again.`, {
          variant: 'error',
          autoHideDuration: 5000,
        });
        return;
      }
      addNode({ ...node, selected: true });
    },
    [addNode, nodeCount, nodesRegistry, viewport],
  );

  const handleInsertHuggingFaceCluster = useCallback(
    async (entry: HuggingFaceCatalogEntry) => {
      if (!huggingFaceLibrary || !entry.insertable || clusterInsertionIds.has(entry.id)) return;
      if (entry.kind === 'block') {
        try {
          prepareWorkflowForManualInsertion();
          addNode(
            modularDiffusersCatalogEntryHasDescendants(entry, huggingFaceLibrary, modularConditionalSnapshot)
              ? createModularDiffusersCatalogFragmentV2(
                  entry,
                  huggingFaceLibrary,
                  nodesRegistry,
                  insertPositionForViewport(viewport, nodeCount),
                  modularConditionalSnapshot,
                )
              : createModularDiffusersCatalogNode(
                  entry,
                  huggingFaceLibrary,
                  nodesRegistry,
                  insertPositionForViewport(viewport, nodeCount),
                  modularConditionalSnapshot,
                ),
          );
        } catch (error) {
          enqueueSnackbar(formatRequestError(error, 'The Modular Diffusers block could not be added.'), {
            variant: 'error',
            autoHideDuration: 7000,
          });
        }
        return;
      }
      if (entry.kind !== 'cluster') return;
      const definition = huggingFaceLibrary.definitions.find((candidate) => candidate.id === entry.id);
      if (!definition) {
        enqueueSnackbar('The exact reviewed Block definition is unavailable. Reload the catalog and try again.', {
          variant: 'error',
          autoHideDuration: 5000,
        });
        return;
      }
      prepareWorkflowForManualInsertion();
      const position = collisionFreeInsertPosition(
        insertPositionForViewport(viewport, nodeCount),
        useFlowStore.getState().nodes,
        {
          width: HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
          height: HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
        },
      );
      setClusterInsertionIds((current) => new Set(current).add(entry.id));
      const pendingId = beginBlockInsertionFeedbackV2(entry.label, position);
      try {
        const { createHuggingFaceClusterForGraph } = await import('../studio/huggingFaceClusterInsertion');
        const cluster = await createHuggingFaceClusterForGraph(definition, position, studioForm, {
          insert: false,
        });
        completeBlockInsertionFeedbackV2(pendingId, cluster);
        if (activeWorkflowTabId) {
          const requestedAt = Date.now();
          setWorkflowFocusRequest({
            workflowTabId: activeWorkflowTabId,
            nodeId: cluster.id,
            requestId: requestedAt,
            requestedAt,
          });
        }
      } catch (error) {
        enqueueSnackbar(formatRequestError(error, 'The registered Block could not be added.'), {
          variant: 'error',
          autoHideDuration: 10_000,
        });
      } finally {
        cancelBlockInsertionFeedbackV2(pendingId);
        setClusterInsertionIds((current) => {
          const next = new Set(current);
          next.delete(entry.id);
          return next;
        });
      }
    },
    [
      activeWorkflowTabId,
      addNode,
      clusterInsertionIds,
      huggingFaceLibrary,
      modularConditionalSnapshot,
      nodeCount,
      nodesRegistry,
      setWorkflowFocusRequest,
      studioForm,
      viewport,
    ],
  );

  const resetHubImport = useCallback(() => {
    setHubImportOpen(false);
    setHubImportRepo('');
    setHubImportRevision('');
    setHubImportReviewed(false);
    setHubImportBusy(false);
    setHubImportError(null);
    setHubImportInspection(null);
  }, []);

  const validatedHubImportSelector = useCallback(() => {
    const repo = hubImportRepo.trim();
    const revision = hubImportRevision.trim().toLowerCase();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(repo)) {
      throw new Error('Enter a Hugging Face repository as owner/name.');
    }
    if (!/^[a-f0-9]{40}$/u.test(revision)) {
      throw new Error('Enter the exact 40-character Hugging Face commit revision.');
    }
    if (!hubImportReviewed) {
      throw new Error('Confirm that you reviewed the repository, license, and exact commit before installing it.');
    }
    return { repo, revision };
  }, [hubImportRepo, hubImportReviewed, hubImportRevision]);

  const handleInspectHuggingFaceUserNode = useCallback(async () => {
    setHubImportError(null);
    let selector: { repo: string; revision: string };
    try {
      selector = validatedHubImportSelector();
    } catch (error) {
      setHubImportError(formatRequestError(error, 'The Hub selector is invalid.'));
      return;
    }
    setHubImportBusy(true);
    try {
      await installHfModel(selector.repo, null, { revision: selector.revision });
      const inspection = await inspectInstalledCustomModularContract(selector.repo, selector.revision);
      setHubImportInspection(inspection);
    } catch (error) {
      setHubImportError(formatRequestError(error, 'Could not install and inspect the exact Hub revision.'));
    } finally {
      setHubImportBusy(false);
    }
  }, [installHfModel, validatedHubImportSelector]);

  const handleImportHuggingFaceUserNode = useCallback(async () => {
    const inspection = hubImportInspection;
    if (!inspection) return;
    const dynamicKey = 'modules.ModularDiffusers.DynamicBlockNode';
    const imported = createNodeFromRegistry(dynamicKey, nodesRegistry, insertPositionForViewport(viewport, nodeCount));
    if (!imported) {
      enqueueSnackbar('The backend does not expose the reviewed Modular Diffusers Dynamic Block Node.', {
        variant: 'error',
        autoHideDuration: 5000,
      });
      return;
    }
    setHubImportBusy(true);
    setHubImportError(null);
    try {
      const runtimeParams = (inspection.runtimeNode?.params ?? {}) as Record<string, NodeParams>;
      const executable = inspection.admission.executable && Boolean(inspection.runtimeNode);
      if (executable) {
        for (const dependency of executableCustomModularDependencies(inspection)) {
          await installHfModel(dependency.repository, null, { revision: dependency.revision });
        }
      }
      const label = `${inspection.definition.label} — ${inspection.repository}@${inspection.revision.slice(0, 7)}`;
      const selectedNode = {
        ...imported,
        selected: true,
        data: {
          ...imported.data,
          label: inspection.runtimeNode?.label || inspection.definition.label,
          category: 'User Nodes',
          description: executable
            ? 'User-owned Modular Diffusers contract imported from an immutable reviewed Hub revision.'
            : 'Remote-code-disabled Hub contract preview. Expand to inspect it; execution remains disabled.',
          params: {
            ...imported.data.params,
            ...runtimeParams,
            repo_id: {
              ...imported.data.params.repo_id,
              value: { source: 'hub', value: inspection.repository },
            },
            revision: {
              ...imported.data.params.revision,
              value: inspection.revision,
            },
            trust_remote_code: {
              ...imported.data.params.trust_remote_code,
              value: false,
              disabled: true,
            },
            modiff_pipeline_identity: {
              ...imported.data.params.modiff_pipeline_identity,
              value: inspection.runtimeNode?.identity ?? null,
            },
            ...(!executable
              ? {
                  load_block_button: {
                    ...imported.data.params.load_block_button,
                    label: 'Repository Python is not authorized',
                    disabled: true,
                  },
                }
              : {}),
          },
          uiState: executable
            ? imported.data.uiState
            : {
                ...imported.data.uiState,
                disabled: true,
                validationSeverity: 'error' as const,
                validationMessage: inspection.admission.reasons.join(' ') || 'Remote-code execution is disabled.',
              },
        },
      };
      const created = createUserBlockFromSelection({ nodes: [selectedNode], edges: [] }, label);
      if (!created.ok) throw new Error(created.reason);
      const saved = await saveUserBlock({
        ...created.block,
        origin: {
          schemaVersion: 1,
          kind: 'hugging_face_hub_import',
          provider: 'diffusers',
          repo: inspection.repository,
          revision: inspection.revision,
          pipelineClass: inspection.admission.pipelineClass ?? undefined,
          compositionKind: 'modiff_graph_snapshot',
          importedAt: Date.now(),
        },
      });
      addNode(createUserBlockNode(saved, insertPositionForViewport(viewport, nodeCount)));
      resetHubImport();
      enqueueSnackbar(
        executable
          ? `Imported executable Block: ${saved.name}`
          : `Saved remote-code-disabled preview to Saved Blocks: ${saved.name}`,
        { variant: 'success', autoHideDuration: 4600 },
      );
    } catch (error) {
      setHubImportError(
        formatRequestError(error, 'Could not install the pinned components or save the imported Block.'),
      );
    } finally {
      setHubImportBusy(false);
    }
  }, [addNode, hubImportInspection, installHfModel, nodeCount, nodesRegistry, resetHubImport, saveUserBlock, viewport]);
  const hubImportProgress = hfDownloadProgress[hubImportRepo.trim()];

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-modiff-border bg-modiff-surface px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-modiff-compact border border-modiff-border bg-modiff-bg text-hf-yellow">
              <Boxes size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-modiff-text">Nodes</h2>
              <p className="truncate text-xs text-modiff-subtle-text">
                {effectiveCatalogView === 'stages' && pipelineSupport.length
                  ? 'Pipeline operations and common utilities'
                  : `${runtimeNodeCount} nodes · ${huggingFaceCatalogCount} catalog entries`}
              </p>
            </div>
          </div>
        </div>
      </header>
      <div className="p-2">
        <ModiffSearchInput
          aria-label="Search nodes"
          placeholder="Search nodes"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          onClear={() => setSearch('')}
        />
      </div>
      {expertMode ? (
        <ModiffTabs
          aria-label="Node catalog level"
          className="mb-0.5 border-y border-modiff-border bg-modiff-surface p-0.5"
          options={[
            { value: 'stages', label: 'Stages' },
            { value: 'essential', label: 'Essentials' },
            { value: 'advanced', label: 'Advanced' },
            { value: 'experimental', label: 'Experimental' },
          ]}
          value={catalogView}
          onValueChange={setCatalogView}
          size="dense"
        />
      ) : null}

      {expertMode ? (
        <div className="px-3 pb-2">
          <ModiffButton onClick={() => setExtensionsOpen(true)}>Custom nodes</ModiffButton>
        </div>
      ) : null}
      <ModiffDialog
        open={extensionsOpen}
        onClose={() => setExtensionsOpen(false)}
        title="Custom nodes"
        panelClassName="max-w-2xl"
        testId="custom-extensions-dialog"
      >
        {extensionsOpen ? (
          <Suspense fallback={null}>
            <CustomExtensionsPanel />
          </Suspense>
        ) : null}
      </ModiffDialog>
      <p className="px-3 pb-2 text-xs text-modiff-subtle-text">
        {effectiveCatalogView === 'stages'
          ? 'Generic stages, common operations, and installed custom nodes. Find implementation details in Advanced.'
          : effectiveCatalogView === 'essential'
            ? 'Task blocks and common operations. More editing tools are available in the Developer workspace.'
            : effectiveCatalogView === 'advanced'
              ? 'Node entries, upstream blocks, and component references. Check each entry’s readiness.'
              : 'Experimental operations. Model and runtime support vary.'}
      </p>

      <div className="min-h-0 flex-1 select-none overflow-y-auto p-1">
        {effectiveCatalogView === 'stages' ? (
          <Suspense fallback={null}>
            <OperationCatalogPanel search={search} onInsert={handleInsertNode} />
          </Suspense>
        ) : null}
        <NodeGroupList
          nodes={catalogNodes}
          search={search}
          view={effectiveCatalogView}
          expertMode={expertMode}
          userBlocks={[...userBlockDefinitionsV2, ...userBlocks]}
          huggingFaceSections={huggingFaceSections}
          huggingFaceLoading={!huggingFaceLibraryLoaded}
          huggingFaceError={huggingFaceLibraryError}
          insertingHuggingFaceDefinitionIds={clusterInsertionIds}
          onRetryHuggingFaceLibrary={fetchHuggingFaceLibrary}
          onInsertNode={handleInsertNode}
          onInsertHuggingFaceCluster={handleInsertHuggingFaceCluster}
          onInsertUserBlock={handleInsertUserBlock}
          onImportHuggingFaceUserNode={() => setHubImportOpen(true)}
          onOpenUserBlockMenu={(block, anchor) => setBlockContextMenu({ block, anchor })}
        />
      </div>
      <ModiffPopover
        open={Boolean(blockContextMenu)}
        onClose={() => setBlockContextMenu(null)}
        anchor={blockContextMenu?.anchor}
        ariaLabel="Block actions"
        role="menu"
        gap={0}
        panelClassName="w-52 p-1"
        testId="user-block-context-menu"
      >
        <ModiffButton
          fullWidth
          align="left"
          tone="danger"
          icon={<Trash2 size={15} />}
          onClick={() => {
            setBlockPendingDelete(blockContextMenu?.block ?? null);
            setBlockContextMenu(null);
          }}
        >
          Delete from Saved Blocks
        </ModiffButton>
      </ModiffPopover>
      <ModiffDialog
        open={Boolean(blockPendingDelete)}
        onClose={() => setBlockPendingDelete(null)}
        title="Delete block definition?"
        testId="delete-user-block-dialog"
        panelClassName="max-w-md"
        footer={
          <>
            <ModiffButton onClick={() => setBlockPendingDelete(null)}>Cancel</ModiffButton>
            <ModiffButton
              tone="danger"
              onClick={() => {
                const block = blockPendingDelete;
                if (!block) return;
                void deleteUserBlock(storedUserBlockId(block))
                  .then(() => setBlockPendingDelete(null))
                  .catch(() => undefined);
              }}
              data-testid="confirm-delete-user-block"
            >
              Delete definition
            </ModiffButton>
          </>
        }
      >
        <p className="text-sm text-modiff-text">
          Existing workflow instances keep their embedded snapshot and continue to work.
        </p>
      </ModiffDialog>
      <ModiffDialog
        open={hubImportOpen}
        onClose={resetHubImport}
        title="Import Block from Hugging Face Hub"
        description="Inspect an exact commit before saving it to your library. Repository Python stays disabled."
        dismissible={!hubImportBusy}
        testId="import-hugging-face-user-node-dialog"
        panelClassName="max-w-2xl"
        toolbar={
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-modiff-subtle-text" role="status">
            <span className={!hubImportInspection ? 'font-semibold text-hf-yellow' : ''}>1. Choose and inspect</span>
            <span className={hubImportInspection ? 'font-semibold text-hf-yellow' : ''}>2. Review and import</span>
            {hubImportBusy ? <span>Working… Please keep this dialog open.</span> : null}
          </div>
        }
        footer={
          <>
            <ModiffButton disabled={hubImportBusy} onClick={resetHubImport}>
              Cancel
            </ModiffButton>
            {hubImportInspection ? (
              <>
                <ModiffButton
                  disabled={hubImportBusy}
                  onClick={() => {
                    setHubImportInspection(null);
                    setHubImportError(null);
                  }}
                >
                  Change repository
                </ModiffButton>
                <ModiffButton
                  data-testid="confirm-hugging-face-user-node-import"
                  loading={hubImportBusy}
                  tone="primary"
                  onClick={() => void handleImportHuggingFaceUserNode()}
                >
                  {hubImportInspection.admission.executable
                    ? 'Install pinned components, save and add'
                    : 'Save to Saved Blocks and add'}
                </ModiffButton>
              </>
            ) : (
              <ModiffButton
                data-testid="inspect-hugging-face-user-node"
                loading={hubImportBusy}
                tone="primary"
                onClick={() => void handleInspectHuggingFaceUserNode()}
              >
                Install exact revision and inspect
              </ModiffButton>
            )}
          </>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm text-modiff-subtle-text">
            Inspecting installs the exact repository revision through Hugging Face Hub. Only contracts made entirely
            from admitted installed Diffusers blocks can run. Saving an inspection-only import does not enable Run.
          </p>
          {!hubImportInspection ? (
            <>
              <ModiffFieldShell label="Repository">
                <ModiffInput
                  autoFocus
                  aria-label="Hugging Face Block repository"
                  disabled={hubImportBusy}
                  placeholder="owner/repository"
                  value={hubImportRepo}
                  onChange={(event) => {
                    setHubImportRepo(event.currentTarget.value);
                    setHubImportReviewed(false);
                    setHubImportError(null);
                  }}
                />
              </ModiffFieldShell>
              <ModiffFieldShell label="Exact commit revision">
                <ModiffInput
                  aria-label="Hugging Face Block revision"
                  disabled={hubImportBusy}
                  placeholder="40-character commit SHA"
                  value={hubImportRevision}
                  onChange={(event) => {
                    setHubImportRevision(event.currentTarget.value);
                    setHubImportReviewed(false);
                    setHubImportError(null);
                  }}
                />
              </ModiffFieldShell>
              <ModiffCheckbox
                checked={hubImportReviewed}
                disabled={hubImportBusy}
                label="I reviewed this repository, its license, and this exact commit"
                onCheckedChange={setHubImportReviewed}
                data-testid="hugging-face-user-node-reviewed"
              />
              {hubImportBusy && hubImportProgress ? (
                <div
                  className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3 text-xs text-modiff-subtle-text"
                  data-testid="hugging-face-user-node-install-progress"
                >
                  {hubImportProgress.status === 'complete'
                    ? 'Installed. Inspecting the declarative contract…'
                    : `Installing exact revision… ${Math.round((hubImportProgress.progress ?? 0) * 100)}%`}
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid gap-3" data-testid="hugging-face-user-node-inspection">
              <div className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3">
                <div className="text-sm font-semibold text-modiff-text">{hubImportInspection.definition.label}</div>
                <div className="mt-1 break-all text-xs text-modiff-subtle-text">
                  {hubImportInspection.repository}@{hubImportInspection.revision}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-modiff-subtle-text">
                  <span>{hubImportInspection.sidecar.filename}</span>
                  <span>·</span>
                  <span>{hubImportInspection.definition.blockCount} blocks</span>
                  <span>·</span>
                  <span>{hubImportInspection.definition.parameterCount} parameters</span>
                  <span>·</span>
                  <span>{hubImportInspection.admission.status.replace('_', ' ')}</span>
                </div>
              </div>
              {hubImportInspection.sidecar.translatedFromMellon ? (
                <div className="rounded-modiff-compact border border-hf-yellow/40 bg-hf-yellow/5 p-3 text-xs text-modiff-text">
                  {hubImportInspection.admission.executable
                    ? 'The official Mellon sidecar was translated into a bounded MoDiff contract. No repository Python was detected or executed.'
                    : 'The official Mellon sidecar was translated for visual inspection. Its repository Python remains disabled, so this import is saved as a non-runnable Block preview.'}
                </div>
              ) : null}
              {hubImportInspection.admission.reasons.length > 0 ? (
                <div className="rounded-modiff-compact border border-modiff-red/40 bg-modiff-red/5 p-3 text-xs text-modiff-text">
                  {hubImportInspection.admission.reasons.join(' ')}
                  {hubImportInspection.admission.recoveryHint ? ` ${hubImportInspection.admission.recoveryHint}` : ''}
                </div>
              ) : null}
              <div className="min-w-0 break-words rounded-modiff-compact border border-modiff-border">
                {hubImportInspection.definition.blocks.map((block) => (
                  <section key={block.id} className="border-b border-modiff-border p-3 last:border-b-0">
                    <div className="text-sm font-semibold text-modiff-text">{block.label}</div>
                    <div className="mt-1 text-xs text-modiff-subtle-text">{block.hierarchy.join(' / ')}</div>
                    <div className="mt-2 grid gap-1 text-xs text-modiff-subtle-text">
                      <div>Inputs: {block.inputNames.join(', ') || 'None'}</div>
                      <div>Model inputs: {block.modelInputNames.join(', ') || 'None'}</div>
                      <div>Outputs: {block.outputNames.join(', ') || 'None'}</div>
                    </div>
                  </section>
                ))}
              </div>
              {hubImportInspection.admission.components.length > 0 ? (
                <div className="break-words rounded-modiff-compact border border-modiff-border p-3 text-xs text-modiff-subtle-text">
                  <div className="mb-2 font-semibold text-modiff-text">Reviewed components</div>
                  {hubImportInspection.admission.components.map((component) => (
                    <div key={component.name}>
                      {component.name}: {component.library}.{component.className} · {component.repository}
                      {component.revision ? `@${component.revision.slice(0, 7)}` : ' · unresolved revision'}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          {hubImportInspection?.remoteCode.requiredForExecution ? (
            <ModiffButton
              disabled={hubImportBusy}
              onClick={() => {
                resetHubImport();
                setExtensionsOpen(true);
              }}
            >
              Manage executable custom nodes
            </ModiffButton>
          ) : null}
          {hubImportError ? (
            <div
              className="rounded-modiff-compact border border-modiff-red/40 bg-modiff-red/5 p-3 text-xs text-modiff-text"
              role="alert"
              data-testid="hugging-face-user-node-import-error"
            >
              {hubImportError}
            </div>
          ) : null}
        </div>
      </ModiffDialog>
    </div>
  );
}

function insertPositionForViewport(viewport: ReturnType<typeof useFlowStore.getState>['viewport'], nodeCount: number) {
  const zoom = viewport.zoom || 1;
  const offset = (nodeCount % 6) * 36;
  return {
    x: (-viewport.x + 180 + offset) / zoom,
    y: (-viewport.y + 120 + offset) / zoom,
  };
}

function collisionFreeInsertPosition(
  initial: { x: number; y: number },
  nodes: ReturnType<typeof useFlowStore.getState>['nodes'],
  size: { width: number; height: number },
) {
  const padding = 32;
  const topLevelNodes = nodes.filter((node) => !node.parentId && !node.hidden);
  const overlapsExistingNode = (position: { x: number; y: number }) =>
    topLevelNodes.some((node) => {
      const width = node.measured?.width ?? node.width ?? 320;
      const height = node.measured?.height ?? node.height ?? 220;
      return (
        position.x < node.position.x + width + padding &&
        position.x + size.width + padding > node.position.x &&
        position.y < node.position.y + height + padding &&
        position.y + size.height + padding > node.position.y
      );
    });

  for (let attempt = 0; attempt < 36; attempt += 1) {
    const column = attempt % 6;
    const row = Math.floor(attempt / 6);
    const candidate = {
      x: initial.x + column * (size.width + padding),
      y: initial.y + row * (size.height + padding),
    };
    if (!overlapsExistingNode(candidate)) return candidate;
  }
  // A fully expanded hierarchy can cover the entire bounded search grid.
  // Falling back to the original point would put a new node on top of it.
  return {
    x: Math.max(
      initial.x,
      ...topLevelNodes.map((node) => node.position.x + (node.measured?.width ?? node.width ?? 320) + padding),
    ),
    y: initial.y,
  };
}

function getIcon(category: string) {
  if (!category) category = 'default';
  switch (category.toLowerCase()) {
    case 'image':
      return <Image size={16} />;
    case 'edit':
    case 'editing':
      return <Filter size={16} />;
    case 'generate':
    case 'generation':
      return <Activity size={16} />;
    case 'condition':
    case 'conditioning':
      return <Webhook size={16} />;
    case 'preview':
      return <Image size={16} />;
    case 'export':
      return <Maximize size={16} />;
    case 'adapters':
      return <Webhook size={16} />;
    case 'audio':
      return <Activity size={16} />;
    case 'video':
      return <LayoutGrid size={16} />;
    case 'text':
      return <Type size={16} />;
    case 'primitive':
      return <BoxIcon size={16} />;
    case 'custom':
      return <User size={16} />;
    case 'load':
    case 'loader':
    case 'loaders':
      return <Truck size={16} />;
    case 'sampler':
      return <Activity size={16} />;
    case 'embedding':
      return <LayoutGrid size={16} />;
    case 'upscaler':
      return <Maximize size={16} />;
    case 'image_filter':
      return <Filter size={16} />;
    default:
      return <Webhook size={16} />;
  }
}

function normalizedTestId(value: string) {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function integrationStatusLabel(status: HuggingFaceCatalogSection['entries'][number]['integrationStatus']) {
  if (status === 'reviewed_modiff_contract') return 'Reviewed MoDiff contract';
  if (status === 'reviewed_transformers_contract') return 'Reviewed Transformers contract';
  if (status === 'equivalent_standard_route') return 'Equivalent standard route';
  if (status === 'contract_only') return 'Contract only';
  return 'Reviewed upstream metadata';
}

type HuggingFaceCatalogTreeNode = {
  id: string;
  label: string;
  entries: HuggingFaceCatalogEntry[];
  children: HuggingFaceCatalogTreeNode[];
};

function huggingFaceCatalogTree(section: HuggingFaceCatalogSection): HuggingFaceCatalogTreeNode[] {
  type MutableTreeNode = Omit<HuggingFaceCatalogTreeNode, 'children'> & {
    children: Map<string, MutableTreeNode>;
  };
  const roots = new Map<string, MutableTreeNode>();
  section.entries.forEach((entry) => {
    let siblings = roots;
    entry.groupPath.forEach((label, index) => {
      const path = entry.groupPath.slice(0, index + 1);
      const id = `${section.id}:${path.join('/')}`;
      const node: MutableTreeNode = siblings.get(label) ?? {
        id,
        label,
        entries: [],
        children: new Map(),
      };
      siblings.set(label, node);
      siblings = node.children;
      if (index === entry.groupPath.length - 1) node.entries.push(entry);
    });
  });
  const freeze = (nodes: Map<string, MutableTreeNode>): HuggingFaceCatalogTreeNode[] =>
    [...nodes.values()]
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((node) => ({
        id: node.id,
        label: node.label,
        entries: [...node.entries].sort(
          (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
        ),
        children: freeze(node.children),
      }));
  return freeze(roots);
}

function huggingFaceCatalogTreeCount(node: HuggingFaceCatalogTreeNode): number {
  return node.entries.length + node.children.reduce((total, child) => total + huggingFaceCatalogTreeCount(child), 0);
}

function HuggingFaceCatalogEntryRow({
  entry,
  insertingDefinitionIds,
  level,
  onInsertCluster,
}: {
  entry: HuggingFaceCatalogEntry;
  insertingDefinitionIds?: ReadonlySet<string>;
  level: number;
  onInsertCluster: (entry: HuggingFaceCatalogEntry) => void;
}) {
  const inserting = Boolean(insertingDefinitionIds?.has(entry.id));
  const content = (
    <>
      <span className="mt-0.5 grid size-4 shrink-0 self-start place-items-center text-hf-yellow">
        {entry.kind === 'cluster' ? <LayoutGrid size={15} /> : <BoxIcon size={15} />}
      </span>
      <span className="min-w-[min(100%,6rem)] flex-1">
        <span className="block break-words whitespace-normal" data-catalog-entry-label>
          {entry.label}
        </span>
        <span className="block truncate text-xs text-modiff-subtle-text">{entry.detail}</span>
      </span>
      <span
        data-catalog-entry-readiness
        className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-modiff-compact border border-modiff-border bg-modiff-bg px-1.5 py-0.5 text-xs font-semibold text-modiff-subtle-text"
      >
        {inserting ? <LoaderCircle size={12} className="animate-spin" aria-hidden="true" /> : null}
        {inserting ? 'Adding…' : entry.readinessLabel}
      </span>
    </>
  );
  const title = entry.insertable
    ? entry.kind === 'block'
      ? `${entry.description} ${integrationStatusLabel(entry.integrationStatus)}. Add this exact pinned Modular Diffusers definition from ${entry.modularBlockContexts?.length ?? 1} compatible context${(entry.modularBlockContexts?.length ?? 1) === 1 ? '' : 's'} as an ordinary composable node.`
      : entry.readiness === 'graph_qualified'
        ? `${entry.description} ${integrationStatusLabel(entry.integrationStatus)}. Custom memory settings use your configured recipe; Automatic checks the exact runtime, installed artifacts, and available resources before submission.`
        : `${entry.description} ${integrationStatusLabel(entry.integrationStatus)}. Insert the reviewed structural Block; execution remains unavailable until its exact graph, artifact, runtime, and resource admission completes.`
    : `${entry.description} ${integrationStatusLabel(entry.integrationStatus)}. Catalog metadata only; insertion is unavailable until its exact graph compiler is admitted.`;
  return entry.insertable ? (
    <TreeButtonRow
      aria-label={`${entry.label}. ${entry.readinessLabel}; insert ${entry.kind === 'cluster' ? 'Block' : 'Modular Diffusers block'}.`}
      className="cursor-pointer flex-wrap gap-y-1 py-1 hover:bg-modiff-surface-hover"
      data-readiness={entry.readiness}
      data-testid={`hugging-face-node-row-${normalizedTestId(entry.id)}`}
      aria-busy={inserting || undefined}
      disabled={inserting}
      draggable={!inserting}
      level={level}
      onClick={() => onInsertCluster(entry)}
      onDragStart={(event) => {
        event.dataTransfer.setData(
          'text/plain',
          entry.kind === 'cluster'
            ? `${HUGGING_FACE_CLUSTER_DRAG_PREFIX}${entry.id}`
            : `${HUGGING_FACE_MODULAR_BLOCK_DRAG_PREFIX}${entry.id}`,
        );
        event.dataTransfer.effectAllowed = 'move';
      }}
      title={title}
    >
      {content}
    </TreeButtonRow>
  ) : (
    <div
      aria-disabled="true"
      aria-label={`${entry.label}. ${entry.readinessLabel}; insertion unavailable.`}
      className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-modiff-compact py-1 pl-2 pr-2 text-sm text-modiff-text"
      data-readiness={entry.readiness}
      data-testid={`hugging-face-node-row-${normalizedTestId(entry.id)}`}
      role="listitem"
      title={title}
    >
      {content}
    </div>
  );
}

function HuggingFaceCatalogTree({
  activeGroupIds,
  forceOpen,
  insertingDefinitionIds,
  level,
  nodes,
  onInsertCluster,
  onToggleGroup,
}: {
  activeGroupIds: string[];
  forceOpen: boolean;
  insertingDefinitionIds?: ReadonlySet<string>;
  level: number;
  nodes: HuggingFaceCatalogTreeNode[];
  onInsertCluster: (entry: HuggingFaceCatalogEntry) => void;
  onToggleGroup: (groupId: string) => void;
}) {
  return nodes.map((node) => {
    const groupId = `hugging-face:${node.id}`;
    const isOpen = forceOpen || activeGroupIds.includes(groupId);
    return (
      <div key={node.id} data-testid={`node-subgroup-${normalizedTestId(node.id)}`}>
        <TreeButtonRow
          aria-expanded={isOpen}
          className="min-h-9 justify-between font-medium"
          level={level}
          onClick={() => onToggleGroup(groupId)}
          open={isOpen}
        >
          <span className="min-w-0 truncate">{node.label}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-modiff-subtle-text">{huggingFaceCatalogTreeCount(node)}</span>
            <ChevronDown
              size={14}
              className={cx('text-modiff-subtle-text transition-transform', isOpen && 'rotate-180')}
            />
          </span>
        </TreeButtonRow>
        {isOpen ? (
          <TreeChildrenPanel level={level + 1}>
            <HuggingFaceCatalogTree
              activeGroupIds={activeGroupIds}
              forceOpen={forceOpen}
              insertingDefinitionIds={insertingDefinitionIds}
              level={level + 1}
              nodes={node.children}
              onInsertCluster={onInsertCluster}
              onToggleGroup={onToggleGroup}
            />
            {node.entries.map((entry) => (
              <HuggingFaceCatalogEntryRow
                key={entry.id}
                entry={entry}
                insertingDefinitionIds={insertingDefinitionIds}
                level={level + 1}
                onInsertCluster={onInsertCluster}
              />
            ))}
          </TreeChildrenPanel>
        ) : null}
      </div>
    );
  });
}

export function HuggingFaceNodeGroups({
  activeGroupIds,
  error,
  insertingDefinitionIds,
  loading,
  onToggleGroup,
  onRetry,
  onInsertCluster,
  searching,
  sections,
}: {
  activeGroupIds: string[];
  error: string | null;
  insertingDefinitionIds?: ReadonlySet<string>;
  loading: boolean;
  onToggleGroup: (groupId: string) => void;
  onRetry: () => Promise<void>;
  onInsertCluster: (entry: HuggingFaceCatalogEntry) => void;
  searching: boolean;
  sections: HuggingFaceCatalogSection[];
}) {
  if (loading) {
    return (
      <div
        aria-live="polite"
        className="mb-1 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3 text-sm text-modiff-subtle-text"
        data-testid="hugging-face-node-catalog-loading"
        role="status"
      >
        Loading Hugging Face node catalog…
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="mb-1 grid gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3 text-sm text-modiff-subtle-text"
        data-testid="hugging-face-node-catalog-error"
        role="alert"
      >
        <span>Hugging Face node catalog unavailable. Runtime nodes and Saved Blocks are unaffected.</span>
        <ModiffButton align="left" className="h-8 px-2 text-xs" onClick={() => void onRetry()} tone="secondary">
          Retry catalog
        </ModiffButton>
      </div>
    );
  }

  return sections.map((section) => {
    const groupId = `hugging-face:${section.id}`;
    const isOpen = searching || activeGroupIds.includes(groupId);
    return (
      <div
        key={section.id}
        data-testid={`node-group-${normalizedTestId(section.label)}`}
        className={cx(
          'mb-1 rounded-modiff-compact border border-transparent transition-colors',
          isOpen && 'border-modiff-border bg-modiff-surface-hover/40',
        )}
      >
        <TreeButtonRow
          aria-expanded={isOpen}
          className="min-h-10 justify-between px-2 font-semibold"
          onClick={() => onToggleGroup(groupId)}
          open={isOpen}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="grid size-4 shrink-0 place-items-center text-hf-yellow">
              {section.id.endsWith('_cluster_nodes') ? <LayoutGrid size={15} /> : <Boxes size={15} />}
            </span>
            <span className="min-w-0 truncate leading-none">{section.label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-modiff-compact border border-modiff-border bg-modiff-bg px-1.5 py-0.5 text-xs font-semibold text-modiff-subtle-text">
              {section.entries.length}
            </span>
            <ChevronDown
              size={16}
              className={cx('text-modiff-subtle-text transition-transform', isOpen && 'rotate-180')}
            />
          </span>
        </TreeButtonRow>
        {isOpen ? (
          <TreeChildrenPanel level={1}>
            <div role="list" aria-label={section.label}>
              <HuggingFaceCatalogTree
                activeGroupIds={activeGroupIds}
                forceOpen={searching}
                insertingDefinitionIds={insertingDefinitionIds}
                level={1}
                nodes={huggingFaceCatalogTree(section)}
                onInsertCluster={onInsertCluster}
                onToggleGroup={onToggleGroup}
              />
            </div>
          </TreeChildrenPanel>
        ) : null}
      </div>
    );
  });
}

type UserBlockCatalogTreeNode = {
  id: string;
  label: string;
  blocks: StoredUserBlockDefinition[];
  children: UserBlockCatalogTreeNode[];
};

function userBlockCatalogTree(
  blocks: StoredUserBlockDefinition[],
  grouping: UserBlockGrouping,
): UserBlockCatalogTreeNode[] {
  type MutableTreeNode = Omit<UserBlockCatalogTreeNode, 'children'> & {
    children: Map<string, MutableTreeNode>;
  };
  const roots = new Map<string, MutableTreeNode>();
  blocks.forEach((block) => {
    let siblings = roots;
    const path = storedUserBlockGroupPath(block, grouping);
    path.forEach((label, index) => {
      const id = `user-nodes:${grouping}:${JSON.stringify(path.slice(0, index + 1))}`;
      const node: MutableTreeNode = siblings.get(label) ?? {
        id,
        label,
        blocks: [],
        children: new Map(),
      };
      siblings.set(label, node);
      siblings = node.children;
      if (index === path.length - 1) node.blocks.push(block);
    });
  });
  const freeze = (nodes: Map<string, MutableTreeNode>): UserBlockCatalogTreeNode[] =>
    [...nodes.values()]
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((node) => ({
        id: node.id,
        label: node.label,
        blocks: [...node.blocks].sort(
          (left, right) =>
            storedUserBlockName(left).localeCompare(storedUserBlockName(right)) ||
            storedUserBlockId(left).localeCompare(storedUserBlockId(right)),
        ),
        children: freeze(node.children),
      }));
  return freeze(roots);
}

function userBlockCatalogTreeCount(node: UserBlockCatalogTreeNode): number {
  return node.blocks.length + node.children.reduce((total, child) => total + userBlockCatalogTreeCount(child), 0);
}

function UserBlockCatalogTree({
  activeGroupIds,
  blocks,
  forceOpen,
  level,
  onInsertUserBlock,
  onOpenUserBlockMenu,
  onToggleGroup,
}: {
  activeGroupIds: string[];
  blocks: UserBlockCatalogTreeNode[];
  forceOpen: boolean;
  level: number;
  onInsertUserBlock: (block: StoredUserBlockDefinition) => void;
  onOpenUserBlockMenu: (block: StoredUserBlockDefinition, anchor: { left: number; top: number }) => void;
  onToggleGroup: (groupId: string) => void;
}) {
  return blocks.map((node) => {
    const groupId = `user-block:${node.id}`;
    const isOpen = forceOpen || activeGroupIds.includes(groupId);
    return (
      <div key={node.id} data-testid={`user-node-subgroup-${normalizedTestId(node.id)}`}>
        <TreeButtonRow
          aria-expanded={isOpen}
          className="min-h-9 justify-between font-medium"
          level={level}
          onClick={() => onToggleGroup(groupId)}
          open={isOpen}
        >
          <span className="min-w-0 truncate">{node.label}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-modiff-subtle-text">{userBlockCatalogTreeCount(node)}</span>
            <ChevronDown
              size={14}
              className={cx('text-modiff-subtle-text transition-transform', isOpen && 'rotate-180')}
            />
          </span>
        </TreeButtonRow>
        {isOpen ? (
          <TreeChildrenPanel level={level + 1}>
            <UserBlockCatalogTree
              activeGroupIds={activeGroupIds}
              blocks={node.children}
              forceOpen={forceOpen}
              level={level + 1}
              onInsertUserBlock={onInsertUserBlock}
              onOpenUserBlockMenu={onOpenUserBlockMenu}
              onToggleGroup={onToggleGroup}
            />
            {node.blocks.map((block) => (
              <TreeButtonRow
                key={storedUserBlockId(block)}
                data-testid={`user-block-row-${normalizedTestId(storedUserBlockId(block))}`}
                draggable
                level={level + 1}
                title={`Add Block · ${storedUserBlockId(block)} · ${storedUserBlockRevision(block)}`}
                className="cursor-grab"
                onClick={() => onInsertUserBlock(block)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onOpenUserBlockMenu(block, { left: event.clientX, top: event.clientY });
                }}
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    'text/plain',
                    `${isBlockDefinitionV2(block) ? USER_BLOCK_V2_DRAG_PREFIX : USER_BLOCK_DRAG_PREFIX}${storedUserBlockId(block)}`,
                  );
                  event.dataTransfer.effectAllowed = 'move';
                }}
              >
                <span className="grid size-4 shrink-0 place-items-center self-start text-hf-yellow">
                  <Boxes size={15} />
                </span>
                <span className="min-w-0 flex-1 whitespace-normal break-words text-left">
                  <span className="block">{storedUserBlockName(block)}</span>
                  <span className="block text-xs text-modiff-subtle-text">{storedUserBlockRevision(block)}</span>
                  <span className="block truncate text-xs text-modiff-subtle-text">{storedUserBlockId(block)}</span>
                </span>
              </TreeButtonRow>
            ))}
          </TreeChildrenPanel>
        ) : null}
      </div>
    );
  });
}

function NodeGroupList({
  nodes,
  search,
  view,
  expertMode,
  userBlocks,
  huggingFaceSections,
  huggingFaceLoading,
  huggingFaceError,
  insertingHuggingFaceDefinitionIds,
  onRetryHuggingFaceLibrary,
  onInsertNode,
  onInsertHuggingFaceCluster,
  onInsertUserBlock,
  onImportHuggingFaceUserNode,
  onOpenUserBlockMenu,
}: {
  nodes: Record<string, NodeData>;
  search: string;
  view: NodeCatalogView;
  expertMode: boolean;
  userBlocks: StoredUserBlockDefinition[];
  huggingFaceSections: HuggingFaceCatalogSection[];
  huggingFaceLoading: boolean;
  huggingFaceError: string | null;
  insertingHuggingFaceDefinitionIds: ReadonlySet<string>;
  onRetryHuggingFaceLibrary: () => Promise<void>;
  onInsertNode: (key: string) => void;
  onInsertHuggingFaceCluster: (entry: HuggingFaceCatalogEntry) => void;
  onInsertUserBlock: (block: StoredUserBlockDefinition) => void;
  onImportHuggingFaceUserNode: () => void;
  onOpenUserBlockMenu: (block: StoredUserBlockDefinition, anchor: { left: number; top: number }) => void;
}) {
  const { activeNodeGroups, setActiveNodeGroups } = useSettingsStore();

  const groups = useMemo(() => {
    return nodeCatalogEntries(nodes)
      .filter((entry) => nodeCatalogEntryMatchesView(entry, view))
      .filter((entry) => nodeCatalogEntryMatchesSearch(entry, search))
      .reduce(
        (acc, entry) => {
          const group = nodeGroupForCatalogEntry(entry, expertMode);
          if (!acc[group]) {
            acc[group] = [];
          }
          acc[group].push(entry);
          return acc;
        },
        {} as Record<string, NodeCatalogEntry[]>,
      );
  }, [expertMode, nodes, search, view]);

  const orderedGroups = Object.entries(groups).sort(([left], [right]) => left.localeCompare(right));
  const userBlockGrouping = useSettingsStore((state) => state.userBlockGrouping);
  const setUserBlockGrouping = useSettingsStore((state) => state.setUserBlockGrouping);
  const matchingUserBlocks = useMemo(() => {
    const unique = uniqueStoredUserBlocks(userBlocks);
    return unique.filter((block) =>
      matchesSearchKeywords(search, [
        'Saved Blocks',
        'User Nodes', // Historical search term; persisted group identity is unchanged.
        storedUserBlockName(block),
        storedUserBlockId(block),
        ...storedUserBlockGroupPath(block),
        ...storedUserBlockGroupPath(block, 'workflow'),
        storedUserBlockRevision(block),
      ]),
    );
  }, [search, userBlocks]);
  const userBlocksOpen = activeNodeGroups.includes('User Nodes') || Boolean(search.trim() && matchingUserBlocks.length);

  return (
    <>
      {view === 'essential' || view === 'advanced' ? (
        <HuggingFaceNodeGroups
          activeGroupIds={activeNodeGroups}
          error={huggingFaceError}
          insertingDefinitionIds={insertingHuggingFaceDefinitionIds}
          loading={huggingFaceLoading}
          onToggleGroup={setActiveNodeGroups}
          onRetry={onRetryHuggingFaceLibrary}
          onInsertCluster={onInsertHuggingFaceCluster}
          searching={Boolean(search.trim())}
          sections={huggingFaceSections}
        />
      ) : null}
      <div
        data-testid="node-group-User-Nodes"
        className={cx(
          'mb-1 rounded-modiff-compact border border-transparent transition-colors',
          userBlocksOpen && 'border-modiff-border bg-modiff-surface-hover/40',
        )}
      >
        <TreeButtonRow
          aria-expanded={userBlocksOpen}
          className="min-h-10 justify-between px-2 font-semibold"
          onClick={() => setActiveNodeGroups('User Nodes')}
          open={userBlocksOpen}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="grid size-4 shrink-0 place-items-center text-hf-yellow">
              <Boxes size={15} />
            </span>
            <span className="min-w-0 truncate leading-none">Saved Blocks</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-modiff-compact border border-modiff-border bg-modiff-bg px-1.5 py-0.5 text-xs font-semibold text-modiff-subtle-text">
              {matchingUserBlocks.length}
            </span>
            <ChevronDown
              size={16}
              className={cx('text-modiff-subtle-text transition-transform', userBlocksOpen && 'rotate-180')}
            />
          </span>
        </TreeButtonRow>
        {userBlocksOpen ? (
          <TreeChildrenPanel level={1}>
            <div className="grid gap-1 px-2 py-2">
              <ModiffSelect
                aria-label="Group Saved Blocks by"
                value={userBlockGrouping}
                options={[
                  { value: 'source', label: 'By source and family' },
                  { value: 'workflow', label: 'By saved workflow context' },
                ]}
                onValueChange={(value) => setUserBlockGrouping(value === 'workflow' ? 'workflow' : 'source')}
              />
              <p className="text-xs text-modiff-subtle-text">
                Saved copies only. Updating replaces the library revision; open workflows keep their own copy.
              </p>
            </div>
            <TreeButtonRow
              data-testid="import-hugging-face-user-node"
              level={1}
              title="Import an immutable Modular Diffusers block from Hugging Face Hub"
              onClick={onImportHuggingFaceUserNode}
            >
              <span className="grid size-4 shrink-0 place-items-center text-hf-yellow">
                <CloudDownload size={15} />
              </span>
              <span className="min-w-0 flex-1 truncate">Import from Hugging Face Hub</span>
            </TreeButtonRow>
            <UserBlockCatalogTree
              activeGroupIds={activeNodeGroups}
              blocks={userBlockCatalogTree(matchingUserBlocks, userBlockGrouping)}
              forceOpen={Boolean(search.trim())}
              level={1}
              onInsertUserBlock={onInsertUserBlock}
              onOpenUserBlockMenu={onOpenUserBlockMenu}
              onToggleGroup={setActiveNodeGroups}
            />
          </TreeChildrenPanel>
        ) : null}
      </div>
      {orderedGroups.length === 0 && matchingUserBlocks.length === 0 && huggingFaceSections.length === 0 ? (
        <div className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3 text-sm text-modiff-subtle-text">
          No nodes match this view.
        </div>
      ) : (
        orderedGroups.map(([group, entries]) => {
          const isOpen = Boolean(search.trim()) || activeNodeGroups.includes(group);
          return (
            <div
              key={group}
              data-testid={`node-group-${normalizedTestId(group)}`}
              className={cx(
                'mb-1 rounded-modiff-compact border border-transparent transition-colors',
                isOpen && 'border-modiff-border bg-modiff-surface-hover/40',
              )}
            >
              <TreeButtonRow
                aria-expanded={isOpen}
                className="min-h-10 justify-between px-2 font-semibold"
                onClick={() => setActiveNodeGroups(group)}
                open={isOpen}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid size-4 shrink-0 place-items-center text-hf-yellow">{getIcon(group)}</span>
                  <span className="min-w-0 truncate leading-none">{group}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded-modiff-compact border border-modiff-border bg-modiff-bg px-1.5 py-0.5 text-xs font-semibold text-modiff-subtle-text">
                    {entries.length}
                  </span>
                  <ChevronDown
                    size={16}
                    className={cx('text-modiff-subtle-text transition-transform', isOpen && 'rotate-180')}
                  />
                </span>
              </TreeButtonRow>
              {isOpen ? (
                <TreeChildrenPanel level={1}>
                  <RuntimeNodeGroupsV2
                    entries={entries}
                    search={search}
                    openGroups={activeNodeGroups}
                    toggle={setActiveNodeGroups}
                    insert={onInsertNode}
                  />
                </TreeChildrenPanel>
              ) : null}
            </div>
          );
        })
      )}
    </>
  );
}

export default NodeList;
