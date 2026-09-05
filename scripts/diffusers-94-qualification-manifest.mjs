#!/usr/bin/env node

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const valuesAfter = (name) =>
  args.flatMap((argument, index) => (argument === name && args[index + 1] ? [args[index + 1]] : []));

const backend = valueAfter('--backend', process.env.MODIFF_LIVE_BACKEND_URL || 'http://127.0.0.1:8088');
const output = resolve(
  valueAfter(
    '--output',
    '../MoDiff/data/review/diffusers-94-hardening-2026-09-05/diffusers-94-qualification-manifest.json',
  ),
);
const evidenceRoots = valuesAfter('--evidence-root').map((path) => resolve(path));
const hierarchyAuditPath = valueAfter('--hierarchy-audit', null);

const fetchJson = async (pathname) => {
  const response = await fetch(new URL(pathname, backend), { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${await response.text()}`);
  return response.json();
};

const listJsonFiles = async (root) => {
  const result = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.json') && (await stat(path)).size <= 5_000_000)
        result.push(path);
    }
  };
  await visit(root);
  return result;
};

const modalityForTask = (taskId = '') => {
  const task = taskId.toLowerCase();
  if (task.includes('audio') || task.includes('music') || task.includes('speech')) return 'audio';
  if (task.includes('video')) return 'video';
  if (task.includes('image') || task.includes('inpaint') || task.includes('outpaint')) return 'image';
  return 'multimodal';
};

const familyForDefinition = (definition) =>
  definition.label?.split(' — ')[0]?.trim() ||
  definition.pipelineClass?.replace(/(?:Modular)?Pipeline$/u, '') ||
  definition.blocksClass;

const library = await fetchJson('/huggingface/node-library');
const cache = await fetchJson('/hf_cache?compact=1&refresh=false');
const hierarchyAudit = hierarchyAuditPath
  ? JSON.parse(await readFile(resolve(hierarchyAuditPath), 'utf8'))
  : { workflows: [] };
const hierarchyByDefinition = new Map((hierarchyAudit.workflows ?? []).map((entry) => [entry.definitionId, entry]));
const definitions = library.definitions.filter(({ definitionKind }) => definitionKind === 'modular_pipeline_workflow');
if (definitions.length !== 94)
  throw new Error(`Expected 94 Modular Diffusers workflows, received ${definitions.length}.`);

const definitionIds = definitions.map(({ id }) => id);
if (new Set(definitionIds).size !== definitionIds.length)
  throw new Error('Duplicate Modular workflow identity detected.');
const cacheByRepository = new Map(cache.map((entry) => [entry.id, entry]));

const evidenceFiles = (await Promise.all(evidenceRoots.map(listJsonFiles))).flat();
const evidenceText = new Map(
  await Promise.all(evidenceFiles.map(async (path) => [path, await readFile(path, 'utf8').catch(() => '')])),
);

const workflows = definitions
  .map((definition) => {
    const admissions = definition.executionAdmissions ?? [];
    const admissionIds = admissions.map(({ id }) => id);
    const artifactRequirements = admissions.flatMap((admission) => {
      const requirements = [admission.artifact, ...(admission.modelDependencies ?? [])].filter(
        (artifact) => artifact?.repo && artifact?.revision,
      );
      return requirements.map(({ repo, revision }) => {
        const cached = cacheByRepository.get(repo);
        return {
          repository: repo,
          revision,
          repositoryPresent: Boolean(cached?.complete),
          exactRevisionComplete: Boolean(cached?.complete && cached?.planned_revision === revision),
          repairRequired: Boolean(cached?.repair_required),
        };
      });
    });
    const evidencePaths = [...evidenceText.entries()]
      .filter(([, text]) => [definition.id, ...admissionIds].some((identity) => text.includes(identity)))
      .map(([path]) => {
        const owner = evidenceRoots.find((root) => path.startsWith(`${root}/`) || path === root);
        return owner ? `${owner}/${relative(owner, path)}` : path;
      });
    const sourceHierarchyDepth = Math.max(
      1,
      ...(definition.blockPlacements ?? []).map((placement) =>
        Math.max(placement.path?.length ?? 0, placement.legacyPath?.split('.').filter(Boolean).length ?? 0),
      ),
    );
    const compiledHierarchy = hierarchyByDefinition.get(definition.id);
    const maxHierarchyDepth = compiledHierarchy?.maximumPlacementPathDepth ?? sourceHierarchyDepth;
    const publication = admissions.map((admission) => ({
      admissionId: admission.id,
      structurallyInsertable: Boolean(admission.publication?.insertable),
      advertisedExecutable: Boolean(admission.publication?.executable),
      liveProof: Boolean(admission.publication?.liveProof),
      autoEligible: Boolean(admission.publication?.autoEligible),
      readiness: admission.publication?.readiness ?? null,
      reasons: admission.publication?.reasons ?? [],
    }));
    const taskId = definition.taskId ?? definition.workflowId ?? 'unknown';
    const family = familyForDefinition(definition);
    return {
      definitionId: definition.id,
      contentHash: definition.contentHash,
      rootBlockDefinitionId: definition.rootBlockDefinitionId,
      label: definition.label,
      family,
      modality: modalityForTask(taskId),
      taskId,
      workflowId: definition.workflowId,
      pipelineClass: definition.pipelineClass,
      blocksClass: definition.blocksClass,
      libraryRevision: definition.libraryRevision,
      maxHierarchyDepth,
      sourceHierarchyDepth,
      semanticBlockPlacements: definition.blockPlacements?.length ?? 0,
      compiledGraph: compiledHierarchy ?? null,
      genericFamilyTaskKey: `${family}:${taskId}`,
      admissions: publication,
      artifacts: artifactRequirements,
      exactPrimaryArtifactCached: artifactRequirements.length > 0 && artifactRequirements[0].exactRevisionComplete,
      allDeclaredArtifactsCached:
        artifactRequirements.length > 0 &&
        artifactRequirements.every(({ exactRevisionComplete }) => exactRevisionComplete),
      evidencePaths,
    };
  })
  .sort((left, right) => left.label.localeCompare(right.label));

const genericGroups = Object.values(
  workflows.reduce((groups, workflow) => {
    const current = groups[workflow.genericFamilyTaskKey] ?? {
      key: workflow.genericFamilyTaskKey,
      family: workflow.family,
      taskId: workflow.taskId,
      workflowIds: [],
    };
    current.workflowIds.push(workflow.workflowId);
    groups[workflow.genericFamilyTaskKey] = current;
    return groups;
  }, {}),
).sort((left, right) => left.key.localeCompare(right.key));

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    backend,
    nodeLibraryRevision: library.diffusersRevision,
    evidenceRoots,
  },
  summary: {
    workflowCount: workflows.length,
    familyCount: new Set(workflows.map(({ family }) => family)).size,
    genericFamilyTaskGroupCount: genericGroups.length,
    exactPrimaryArtifactCachedCount: workflows.filter(({ exactPrimaryArtifactCached }) => exactPrimaryArtifactCached)
      .length,
    allDeclaredArtifactsCachedCount: workflows.filter(({ allDeclaredArtifactsCached }) => allDeclaredArtifactsCached)
      .length,
    workflowsWithCurrentEvidenceCount: workflows.filter(({ evidencePaths }) => evidencePaths.length > 0).length,
    maxHierarchyDepth: Math.max(...workflows.map(({ maxHierarchyDepth }) => maxHierarchyDepth)),
    duplicateWorkflowIdentities: definitionIds.length - new Set(definitionIds).size,
  },
  genericGroups,
  workflows,
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, ...manifest.summary }, null, 2));
