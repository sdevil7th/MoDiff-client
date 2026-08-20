#!/usr/bin/env node
/** Build a deterministic, fail-closed retry ledger from a generation report. */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const DEFAULT_REPORT = join(BACKEND_ROOT, 'review-pending', 'generation-campaign-report.v1.json');
const DEFAULT_OUTPUT = join(BACKEND_ROOT, 'review-pending', 'generation-campaign-retry-ledger.v1.json');

const CLASSIFIERS = [
  {
    category: 'graph_client_lifecycle',
    defect: 'browser_page_lifecycle',
    pattern: /Target page|Target crashed|Page crashed|browser has been closed/i,
  },
  {
    category: 'graph_client_lifecycle',
    defect: 'graph_finalization',
    pattern: /Graph finalized|graph final|finaliz/i,
  },
  {
    category: 'runtime',
    defect: 'optional_runtime',
    pattern: /optional runtime|optional-runtime/i,
  },
  {
    category: 'dependency',
    defect: 'opencv_gallery_media',
    pattern: /OpenCV|gallery-media extra/i,
  },
  {
    category: 'artifact',
    defect: 'controlled_artifact_receipt',
    pattern: /controlled (?:workflow )?artifact|controlled artifact byteSize/i,
  },
  {
    category: 'artifact',
    defect: 'incomplete_model',
    pattern: /incomplete model|model.+incomplete|incomplete.+model/i,
  },
  {
    category: 'artifact',
    defect: 'missing_model',
    pattern: /is missing|not found in MoDiff runnable model indexes/i,
  },
  {
    category: 'output_integrity',
    defect: 'implausibly_small_output',
    pattern: /too small to be a campaign/i,
  },
  {
    category: 'backend_action',
    defect: 'backend_managed_identity_field',
    pattern: /backend-managed and cannot participate in model identity/i,
  },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function classifyCampaignFailure(error) {
  const message = typeof error === 'string' ? error : '';
  const match = CLASSIFIERS.find((classifier) => classifier.pattern.test(message));
  if (!match) {
    return { category: 'unclassified', defect: 'requires_manual_classification' };
  }
  return { category: match.category, defect: match.defect };
}

export function buildRetryLedger(
  report,
  {
    sourceReportSha256 = null,
    qualityRejections = [],
    qualityRejectionsSha256 = null,
    qualityAcceptances = [],
    qualityAcceptancesSha256 = null,
  } = {},
) {
  if (!report || !Array.isArray(report.results)) {
    throw new Error('Generation campaign report must contain a results array.');
  }
  const seen = new Set();
  const retryByWorkflow = new Map();
  for (const result of report.results) {
    const workflowId = typeof result?.workflowId === 'string' ? result.workflowId.trim() : '';
    if (!workflowId) throw new Error('Every campaign result must identify a workflow.');
    if (seen.has(workflowId)) throw new Error(`Duplicate campaign result for ${workflowId}.`);
    seen.add(workflowId);
    if (result.status !== 'failed') continue;
    const error = typeof result.error === 'string' ? result.error : '';
    if (!error.trim()) throw new Error(`Failed campaign result ${workflowId} has no preserved error.`);
    const classification = classifyCampaignFailure(error);
    retryByWorkflow.set(workflowId, {
      workflowId,
      skeletonId: typeof result.skeletonId === 'string' ? result.skeletonId : null,
      state: 'classified',
      nextState: 'reproduction',
      maySkip: false,
      externalBlocker: null,
      ...classification,
      error,
    });
  }
  const qualityAttemptCount = new Map();
  for (const receipt of qualityRejections) {
    const workflowId = typeof receipt?.workflowId === 'string' ? receipt.workflowId.trim() : '';
    if (!workflowId) throw new Error('Every quality rejection must identify a workflow.');
    if (receipt.outcome !== 'rerun_required') continue;
    const reason = typeof receipt.reason === 'string' ? receipt.reason.trim() : '';
    const correctiveAction = typeof receipt.correctiveAction === 'string' ? receipt.correctiveAction.trim() : '';
    if (!reason || !correctiveAction) {
      throw new Error(`Quality rejection ${workflowId} must preserve a reason and corrective action.`);
    }
    qualityAttemptCount.set(workflowId, (qualityAttemptCount.get(workflowId) || 0) + 1);
    retryByWorkflow.set(workflowId, {
      workflowId,
      skeletonId: report.results.find((result) => result.workflowId === workflowId)?.skeletonId || null,
      state: 'classified',
      nextState: 'fix',
      maySkip: false,
      externalBlocker: null,
      category: 'quality',
      defect: 'quality_review_rejected',
      error: reason,
      correctiveAction,
      latestTaskId: typeof receipt.taskId === 'string' ? receipt.taskId : null,
      latestMediaPath: typeof receipt.mediaPath === 'string' ? receipt.mediaPath : null,
      latestMediaSha256: typeof receipt.mediaSha256 === 'string' ? receipt.mediaSha256 : null,
      sourceFixtureRightsState:
        typeof receipt.sourceFixtureRightsState === 'string' ? receipt.sourceFixtureRightsState : null,
    });
  }
  for (const receipt of qualityAcceptances) {
    const workflowId = typeof receipt?.workflowId === 'string' ? receipt.workflowId.trim() : '';
    if (!workflowId) throw new Error('Every quality acceptance must identify a workflow.');
    if (receipt.outcome !== 'shortlisted_for_user_review') continue;
    const result = report.results.find((item) => item.workflowId === workflowId);
    const matchesLatestCompletion =
      result?.status === 'completed' &&
      typeof result.taskId === 'string' &&
      typeof receipt.taskId === 'string' &&
      receipt.taskId === result.taskId;
    if (matchesLatestCompletion && retryByWorkflow.get(workflowId)?.category === 'quality') {
      retryByWorkflow.delete(workflowId);
    }
  }
  const retries = [...retryByWorkflow.values()];
  for (const retry of retries) {
    if (retry.category === 'quality') {
      retry.qualityAttemptCount = qualityAttemptCount.get(retry.workflowId) || 1;
    }
  }
  retries.sort((left, right) => left.workflowId.localeCompare(right.workflowId));
  const byCategory = {};
  const byDefect = {};
  for (const retry of retries) {
    byCategory[retry.category] = (byCategory[retry.category] || 0) + 1;
    byDefect[retry.defect] = (byDefect[retry.defect] || 0) + 1;
  }
  return {
    schemaVersion: 1,
    kind: 'generation_campaign_retry_ledger',
    source: {
      server: typeof report.server === 'string' ? report.server : null,
      resultCount: report.results.length,
      reportSha256: sourceReportSha256,
      qualityRejectionCount: qualityRejections.length,
      qualityRejectionsSha256,
      qualityAcceptanceCount: qualityAcceptances.length,
      qualityAcceptancesSha256,
    },
    policy: {
      stateMachine: ['failed', 'classified', 'reproduction', 'fix', 'regression_test', 'same_workflow_rerun'],
      failedToSkippedAllowed: false,
      completionRequiresSuccessfulRerunOrExplicitExternalBlocker: true,
    },
    summary: {
      retryCount: retries.length,
      unclassifiedCount: retries.filter((retry) => retry.category === 'unclassified').length,
      byCategory: Object.fromEntries(Object.entries(byCategory).sort()),
      byDefect: Object.fromEntries(Object.entries(byDefect).sort()),
    },
    retries,
  };
}

export function retryLedgerForReportBytes(reportBytes, { qualityRejections = [], qualityAcceptances = [] } = {}) {
  const report = JSON.parse(reportBytes.toString('utf8'));
  return buildRetryLedger(report, {
    sourceReportSha256: sha256(reportBytes),
    qualityRejections,
    qualityRejectionsSha256: sha256(Buffer.from(JSON.stringify(qualityRejections))),
    qualityAcceptances,
    qualityAcceptancesSha256: sha256(Buffer.from(JSON.stringify(qualityAcceptances))),
  });
}

export function readQualityRejections(pendingRoot) {
  const rejectedRoot = join(pendingRoot, 'rejected');
  if (!existsSync(rejectedRoot)) return [];
  const pending = [rejectedRoot];
  const paths = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) pending.push(path);
      else if (name.endsWith('.quality-rejection.json')) paths.push(path);
    }
  }
  return paths.sort().map((path) => {
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    if (receipt?.kind !== 'generation_quality_rejection') {
      throw new Error(`Unexpected quality rejection kind: ${path}`);
    }
    return receipt;
  });
}

export function readQualityAcceptances(pendingRoot) {
  if (!existsSync(pendingRoot)) return [];
  const paths = [];
  for (const name of readdirSync(pendingRoot)) {
    if (name === 'rejected') continue;
    const directory = join(pendingRoot, name);
    if (!statSync(directory).isDirectory()) continue;
    for (const childName of readdirSync(directory)) {
      if (childName.endsWith('.quality-acceptance.json')) {
        paths.push(join(directory, childName));
      }
    }
  }
  return paths.sort().map((path) => {
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    if (receipt?.kind !== 'generation_quality_acceptance') {
      throw new Error(`Unexpected quality acceptance kind: ${path}`);
    }
    return receipt;
  });
}

export function writeRetryLedger(reportPath = DEFAULT_REPORT, outputPath = DEFAULT_OUTPUT) {
  if (!existsSync(reportPath)) throw new Error(`Generation campaign report is missing: ${reportPath}`);
  const document = retryLedgerForReportBytes(readFileSync(reportPath), {
    qualityRejections: readQualityRejections(dirname(reportPath)),
    qualityAcceptances: readQualityAcceptances(dirname(reportPath)),
  });
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, serialized, { flag: 'wx' });
    renameSync(temporaryPath, outputPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return document;
}

function parseArgs(argv) {
  let reportPath = DEFAULT_REPORT;
  let outputPath = DEFAULT_OUTPUT;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--report') {
      reportPath = resolve(argv[index + 1] || '');
      index += 1;
    } else if (argv[index] === '--output') {
      outputPath = resolve(argv[index + 1] || '');
      index += 1;
    } else if (argv[index] === '--check') {
      check = true;
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  return { reportPath, outputPath, check };
}

function main() {
  const { reportPath, outputPath, check } = parseArgs(process.argv.slice(2));
  const reportBytes = readFileSync(reportPath);
  const document = retryLedgerForReportBytes(reportBytes, {
    qualityRejections: readQualityRejections(dirname(reportPath)),
    qualityAcceptances: readQualityAcceptances(dirname(reportPath)),
  });
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (check) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== serialized) {
      throw new Error(`Retry ledger is missing or stale: ${outputPath}`);
    }
  } else {
    writeRetryLedger(reportPath, outputPath);
  }
  console.log(
    `${check ? 'Verified' : 'Wrote'} ${document.summary.retryCount} retry records ` +
      `(${document.summary.unclassifiedCount} unclassified): ${outputPath}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
