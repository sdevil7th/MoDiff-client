import { useCallback, useEffect, useRef, useState } from 'react';
import { FileClock, RefreshCw, RotateCcw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';

import {
  applyCompositeMigration,
  canApplyCompositeMigration,
  COMPOSITE_MIGRATION_APPLY_CONFIRMATION,
  COMPOSITE_MIGRATION_ROLLBACK_CONFIRMATION,
  fetchCompositeMigrationList,
  fetchCompositeMigrationPreview,
  fetchCompositeMigrationStatus,
  formatCompositeMigrationError,
  parseRegisteredClusterCompilerSupplement,
  rollbackCompositeMigration,
  type CompositeMigrationPreview,
  type CompositeMigrationStatus,
  type RegisteredClusterCompilerSupplement,
} from '../studio/compositeMigrationApi';
import {
  fetchLegacyClusterRecoveryAudit,
  type LegacyClusterRecoveryAudit,
} from '../studio/legacyClusterRecoveryAuditApi';
import {
  generateRegisteredClusterCompilerSupplement,
  type RegisteredClusterCompilerDiagnostic,
  type RegisteredClusterCompilerProgress,
} from '../studio/registeredClusterCompilerSupplement';
import { useStudioStore } from '../stores/useStudioStore';
import {
  enqueueSnackbar,
  ModiffButton,
  ModiffCheckbox,
  ModiffDialog,
  ModiffDisclosure,
  ModiffFieldShell,
  ModiffInput,
  ModiffTextarea,
  StatusActionChip,
} from '../ui';
import { cx } from '../utils/classNames';

function stateLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function statusTone(status: CompositeMigrationStatus['effectiveState']) {
  if (status === 'applied' || status === 'rolled_back') return 'success' as const;
  if (status === 'interrupted') return 'warning' as const;
  return 'error' as const;
}

export function LegacyClusterRecoveryEvidencePanel({
  audit,
  error,
  loading,
  onRefresh,
}: {
  audit: LegacyClusterRecoveryAudit | null;
  error?: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const recoveredIdentities =
    audit?.identities.filter((identity) => identity.recoveredStudioSpecs.status === 'partial_evidence_available') ?? [];
  return (
    <div className="grid gap-3" data-testid="legacy-cluster-recovery-evidence-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-5 text-modiff-subtle-text">
          This read-only audit reports historical recovery evidence and checked-in compiler-mapping coverage. It does
          not compile, convert, execute, approve, or mutate a Cluster by itself. Mapping-ready instances still require
          an exact compiler supplement, reviewed preview, and explicit apply confirmation.
        </p>
        <ModiffButton
          size="compact"
          tone="secondary"
          icon={<RefreshCw size={14} />}
          loading={loading}
          disabled={loading}
          onClick={onRefresh}
          data-testid="legacy-cluster-recovery-evidence-refresh"
        >
          Refresh evidence
        </ModiffButton>
      </div>
      {error ? (
        <div className="flex items-start gap-2 rounded-modiff-compact border border-modiff-red/40 bg-modiff-red/5 p-2 text-xs text-modiff-red">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      ) : null}
      {audit ? (
        <>
          <div className="flex flex-wrap gap-2" data-testid="legacy-cluster-recovery-evidence-summary">
            <StatusActionChip label={`${audit.summary.legacyClusterInstanceCount} saved Clusters`} tone="neutral" />
            <StatusActionChip
              label={`${audit.summary.compilerMappingEligibleInstanceCount} mapping-ready instances`}
              tone={audit.summary.compilerMappingEligibleInstanceCount ? 'success' : 'neutral'}
            />
            <StatusActionChip
              label={`${audit.summary.compilerMappingEligibleIdentityCount} mapping-ready ${
                audit.summary.compilerMappingEligibleIdentityCount === 1 ? 'identity' : 'identities'
              }`}
              tone={audit.summary.compilerMappingEligibleIdentityCount ? 'success' : 'neutral'}
            />
            <StatusActionChip
              label={`${audit.summary.remainingBlockedHistoricalInstanceCount} historical still blocked`}
              tone={audit.summary.remainingBlockedHistoricalInstanceCount ? 'warning' : 'success'}
            />
            <StatusActionChip
              label={`${audit.summary.remainingBlockedHistoricalIdentityCount} blocked ${
                audit.summary.remainingBlockedHistoricalIdentityCount === 1 ? 'identity' : 'identities'
              }`}
              tone={audit.summary.remainingBlockedHistoricalIdentityCount ? 'warning' : 'success'}
            />
            <StatusActionChip label={`${audit.summary.recoveredStudioSpecBodyCount} recovered bodies`} tone="neutral" />
            <StatusActionChip
              label={`${audit.summary.recoveredStudioSpecManifestIdentityCount} identities`}
              tone="neutral"
            />
            <StatusActionChip
              label={`${audit.summary.recoveredStudioSpecExecutionTupleCount} execution tuples`}
              tone="neutral"
            />
            <StatusActionChip
              label={`${audit.summary.recoveredStudioSpecInstanceCount} covered instances`}
              tone="neutral"
            />
            <StatusActionChip
              label={`${audit.summary.partialReviewVerifiedExecutionTupleCount} partially reviewed`}
              tone={audit.summary.partialReviewVerifiedExecutionTupleCount ? 'warning' : 'neutral'}
            />
          </div>
          <div className="rounded-modiff-compact border border-hf-orange/40 bg-hf-orange/5 p-2 text-xs leading-5 text-modiff-text">
            Read-only boundary: no workflow paths, instance IDs, prompts, or parameter values are included. A valid
            historical Studio-spec self-hash is partial evidence only; it is not manifest, interface, artifact, or
            execution authority. A checked-in compiler mapping covers only its exact archived tuple and does not, by its
            presence alone, authorize conversion or workflow mutation.
          </div>
          <section className="grid gap-1.5">
            <h4 className="text-xs font-bold uppercase text-modiff-subtle-text">
              Recovered Studio bodies ({audit.specifications.length})
            </h4>
            {audit.specifications.length ? (
              <div className="grid max-h-72 gap-2 overflow-auto" data-testid="legacy-cluster-recovered-specifications">
                {audit.specifications.map((specification) => (
                  <article
                    key={specification.canonicalBodySha256}
                    className="grid gap-1 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-all font-mono text-modiff-text">{specification.identity.id}</p>
                        <p className="text-modiff-subtle-text">
                          {specification.modelType} · {specification.mode} · {specification.identity.executionProfileId}
                        </p>
                      </div>
                      <StatusActionChip
                        label={`${specification.roleCount} roles · ${specification.edgeCount} edges`}
                        tone="neutral"
                      />
                    </div>
                    <p className="break-all font-mono text-modiff-subtle-text">
                      {specification.identity.contentHash} · {specification.canonicalBodySha256}
                    </p>
                    <p className="text-modiff-subtle-text">
                      {specification.bindingCount} bindings · {specification.actionCount} dynamic actions · sources:{' '}
                      {specification.sourceIds.join(', ')}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-xs text-modiff-subtle-text">No exact local capture contains a matching body.</p>
            )}
          </section>
          <section className="grid gap-1.5">
            <h4 className="text-xs font-bold uppercase text-modiff-subtle-text">
              Historical identities with partial evidence ({recoveredIdentities.length})
            </h4>
            {recoveredIdentities.length ? (
              <div className="grid max-h-80 gap-2 overflow-auto" data-testid="legacy-cluster-recovered-identities">
                {recoveredIdentities.map((identity) => (
                  <article
                    key={`${identity.definitionId}:${identity.libraryRevision}:${identity.manifestContentHash}`}
                    className="grid gap-1.5 rounded-modiff-compact border border-hf-orange/30 bg-modiff-bg p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="break-all font-mono text-modiff-text">
                        {identity.definitionId ?? 'Malformed identity'}
                      </p>
                      <StatusActionChip label={`${identity.instanceCount} instances`} tone="warning" />
                    </div>
                    <p className="break-all font-mono text-modiff-subtle-text">
                      {identity.libraryRevision ?? 'missing revision'} ·{' '}
                      {identity.manifestContentHash ?? 'missing hash'}
                    </p>
                    {identity.executionTuples
                      .filter((tuple) => tuple.recoveredStudioSpec.status === 'self_hash_valid_partial_evidence')
                      .map((tuple, index) => (
                        <div
                          key={`${tuple.admissionId ?? 'missing'}:${tuple.studioExecutionSpec?.contentHash ?? index}`}
                          className="rounded-modiff-compact border border-modiff-border p-2"
                        >
                          <p className="break-all font-mono text-modiff-text">
                            {tuple.studioExecutionSpec?.id ?? 'Missing Studio receipt'}
                          </p>
                          <p className="text-modiff-subtle-text">
                            {tuple.instanceCount} instances · review {stateLabel(tuple.manualReview.status)} ·
                            conversion authority: none
                          </p>
                        </div>
                      ))}
                    <p className="text-hf-orange">
                      Still missing: {identity.missingEvidence.map(({ code }) => stateLabel(code)).join('; ')}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-xs text-modiff-subtle-text">No historical identity has recovered partial evidence.</p>
            )}
          </section>
          <p className="break-all font-mono text-xs text-modiff-subtle-text">Audit: {audit.contentHash}</p>
        </>
      ) : !loading && !error ? (
        <p className="text-xs text-modiff-subtle-text">No historical recovery audit is available.</p>
      ) : null}
    </div>
  );
}

export function CompositeMigrationPreviewDetails({ preview }: { preview: CompositeMigrationPreview }) {
  const semanticEquivalenceReviews = [
    ...new Map(
      preview.candidates.flatMap((candidate) => {
        const authority =
          candidate.compilerReceipt?.semanticEquivalenceAuthority ?? candidate.semanticEquivalenceAuthority;
        return authority ? [[authority.receiptHash, authority] as const] : [];
      }),
    ).values(),
  ];
  const historicalCompilerMappings = [
    ...new Map(
      preview.candidates.flatMap((candidate) => {
        const authority =
          candidate.compilerReceipt?.historicalCompilerMappingAuthority ?? candidate.historicalCompilerMappingAuthority;
        return authority ? [[authority.mappingHash, authority] as const] : [];
      }),
    ).values(),
  ];
  return (
    <div className="grid gap-3" data-testid="composite-migration-preview-details">
      <div className="flex flex-wrap gap-2">
        <StatusActionChip label={`${preview.summary.targetFileCount} target files`} tone="neutral" />
        <StatusActionChip
          label={`${preview.summary.convertibleCandidateCount} convertible`}
          tone={preview.summary.convertibleCandidateCount ? 'success' : 'neutral'}
        />
        {preview.compilerSupplement ? (
          <StatusActionChip
            label={`${preview.summary.registeredClusterConvertibleCount ?? 0} registered Clusters compiled`}
            tone={preview.compilerSupplement.provided ? 'success' : 'neutral'}
          />
        ) : null}
        <StatusActionChip
          label={`${preview.summary.blockedCandidateCount} blocked`}
          tone={preview.summary.blockedCandidateCount ? 'warning' : 'success'}
        />
      </div>
      <div className="grid gap-1 text-xs text-modiff-subtle-text">
        <p className="break-all">
          Preview: <span className="font-mono text-modiff-text">{preview.migrationId}</span>
        </p>
        <p className="break-all">
          Plan hash: <span className="font-mono text-modiff-text">{preview.planHash}</span>
        </p>
        {preview.compilerSupplement?.contentHash ? (
          <p className="break-all">
            Compiler supplement:{' '}
            <span className="font-mono text-modiff-text">{preview.compilerSupplement.contentHash}</span>
          </p>
        ) : null}
      </div>
      <section className="grid gap-1.5">
        <h4 className="text-xs font-bold uppercase text-modiff-subtle-text">Exact files that would change</h4>
        {preview.targets.length ? (
          <ul className="max-h-44 space-y-1 overflow-auto rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2">
            {preview.targets.map((target) => (
              <li key={target.sourcePath} className="break-all font-mono text-xs text-modiff-text">
                {target.sourcePath}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-modiff-subtle-text">No safe conversion target is present.</p>
        )}
      </section>
      {semanticEquivalenceReviews.length ? (
        <section className="grid gap-1.5" data-testid="composite-migration-equivalence-diffs">
          <h4 className="text-xs font-bold uppercase text-hf-yellow">Reviewed historical equivalence (preview only)</h4>
          <div className="grid max-h-72 gap-2 overflow-auto">
            {semanticEquivalenceReviews.map((authority) => (
              <article
                key={authority.receiptHash}
                className="grid gap-1 rounded-modiff-compact border border-hf-yellow/30 bg-hf-yellow/5 p-2 text-xs"
              >
                <p className="break-all font-mono text-modiff-text">{authority.receiptId}</p>
                <p className="break-all text-modiff-subtle-text">
                  Historical manifest: <span className="font-mono">{authority.historical.manifestContentHash}</span>
                </p>
                <p className="break-all text-modiff-subtle-text">
                  Historical graph/interface:{' '}
                  <span className="font-mono">
                    {authority.historical.executionGraphHash} · {authority.historical.interfaceHash}
                  </span>
                </p>
                <p className="break-all text-modiff-subtle-text">
                  Destination definition:{' '}
                  <span className="font-mono">{authority.destination.blockDefinitionContentHash}</span>
                </p>
                <p className="break-all text-modiff-subtle-text">
                  Destination graph/interface:{' '}
                  <span className="font-mono">
                    {authority.destination.executionGraphHash} · {authority.destination.interfaceHash}
                  </span>
                </p>
                <p className="text-modiff-subtle-text">
                  Reviewed by {authority.review.issuer} at {authority.review.reviewedAt}: {authority.review.notes}
                </p>
                <p className="text-hf-yellow">
                  This checked-in review enables exact compiler validation only; it does not apply or mutate a workflow.
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {historicalCompilerMappings.length ? (
        <section className="grid gap-1.5" data-testid="composite-migration-archived-compiler-mappings">
          <h4 className="text-xs font-bold uppercase text-hf-yellow">
            Reviewed archived compiler mapping (preview only)
          </h4>
          <div className="grid max-h-72 gap-2 overflow-auto">
            {historicalCompilerMappings.map((authority) => (
              <article
                key={authority.mappingHash}
                className="grid gap-1 rounded-modiff-compact border border-hf-yellow/30 bg-hf-yellow/5 p-2 text-xs"
              >
                <p className="break-all font-mono text-modiff-text">{authority.mappingId}</p>
                <p className="break-all text-modiff-subtle-text">
                  Archived manifest: <span className="font-mono">{authority.historical.manifestContentHash}</span>
                </p>
                <p className="break-all text-modiff-subtle-text">
                  Archive record: <span className="font-mono">{authority.historical.archivedDefinitionRecordHash}</span>
                </p>
                <p className="break-all text-modiff-subtle-text">
                  Destination definition:{' '}
                  <span className="font-mono">{authority.destination.blockDefinitionContentHash}</span>
                </p>
                <p className="break-all text-modiff-subtle-text">
                  Destination graph/interface:{' '}
                  <span className="font-mono">
                    {authority.destination.executionGraphHash} · {authority.destination.interfaceHash}
                  </span>
                </p>
                <p className="text-modiff-subtle-text">
                  Reviewed by {authority.review.issuer} at {authority.review.reviewedAt}: {authority.review.notes}
                </p>
                <p className="text-hf-yellow">
                  This maps one exact archived body to one exact compiler destination. Per-instance preservation,
                  explicit Apply, byte backup, and rollback are still required.
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {preview.blocked.length ? (
        <section className="grid gap-1.5" data-testid="composite-migration-blockers">
          <h4 className="text-xs font-bold uppercase text-hf-orange">Blocked candidates remain unchanged</h4>
          <ul className="max-h-44 space-y-2 overflow-auto rounded-modiff-compact border border-hf-orange/40 bg-hf-orange/5 p-2">
            {preview.blocked.map((candidate, index) => (
              <li key={`${candidate.sourcePath}:${candidate.kind}:${candidate.id ?? index}`} className="text-xs">
                <p className="break-all font-mono text-modiff-text">{candidate.sourcePath}</p>
                <p className="text-modiff-subtle-text">
                  {candidate.id ? `${candidate.id}: ` : ''}
                  {candidate.reason}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {preview.inventoryIssues.length ? (
        <section className="grid gap-1.5">
          <h4 className="text-xs font-bold uppercase text-hf-orange">Inventory issues</h4>
          <ul className="max-h-36 space-y-1 overflow-auto text-xs text-modiff-subtle-text">
            {preview.inventoryIssues.map((issue, index) => (
              <li key={`${issue.sourcePath}:${issue.path}:${issue.code}:${index}`}>
                <span className="break-all font-mono text-modiff-text">{issue.sourcePath}</span>: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function CompositeMigrationApplyReview({
  allowBlockedCandidates,
  busy,
  confirmation,
  error,
  onAllowBlockedCandidatesChange,
  onApply,
  onCancel,
  onConfirmationChange,
  preview,
}: {
  allowBlockedCandidates: boolean;
  busy: boolean;
  confirmation: string;
  error?: string | null;
  onAllowBlockedCandidatesChange: (checked: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
  onConfirmationChange: (value: string) => void;
  preview: CompositeMigrationPreview;
}) {
  const canApply = canApplyCompositeMigration(preview, confirmation, allowBlockedCandidates);
  return (
    <div className="grid gap-4" data-testid="composite-migration-apply-review">
      <div className="rounded-modiff-compact border border-hf-orange/40 bg-hf-orange/5 p-3 text-xs leading-5 text-modiff-text">
        This action creates exact backups and replaces only the listed safe User Node or workflow files. It never
        deletes, renames, or merges records. Blocked candidates remain unchanged.
      </div>
      <CompositeMigrationPreviewDetails preview={preview} />
      {preview.summary.blockedCandidateCount > 0 ? (
        <ModiffCheckbox
          checked={allowBlockedCandidates}
          onCheckedChange={onAllowBlockedCandidatesChange}
          label={`Apply only the ${preview.summary.targetFileCount} safe target files and leave all ${preview.summary.blockedCandidateCount} blocked candidates unchanged.`}
          data-testid="composite-migration-allow-blocked"
        />
      ) : null}
      <ModiffFieldShell
        label={
          <span>
            Type <code className="font-mono text-hf-yellow">{COMPOSITE_MIGRATION_APPLY_CONFIRMATION}</code>
          </span>
        }
        required
        error={error ?? undefined}
      >
        <ModiffInput
          autoComplete="off"
          spellCheck={false}
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.currentTarget.value)}
          data-testid="composite-migration-apply-confirmation"
        />
      </ModiffFieldShell>
      <div className="flex flex-wrap justify-end gap-2 border-t border-modiff-border pt-3">
        <ModiffButton disabled={busy} onClick={onCancel}>
          Cancel
        </ModiffButton>
        <ModiffButton
          tone="primary"
          loading={busy}
          disabled={busy || !canApply}
          onClick={onApply}
          data-testid="composite-migration-apply"
        >
          Apply reviewed migration
        </ModiffButton>
      </div>
    </div>
  );
}

export function CompositeMigrationRecoveryList({
  busyId,
  migrations,
  onInspectRollback,
}: {
  busyId?: string | null;
  migrations: CompositeMigrationStatus[];
  onInspectRollback: (status: CompositeMigrationStatus) => void;
}) {
  if (!migrations.length)
    return <p className="text-xs text-modiff-subtle-text">No migration recovery journals are present.</p>;
  return (
    <div className="grid max-h-72 gap-2 overflow-auto" data-testid="composite-migration-recovery-list">
      {migrations.map((migration) => (
        <section
          key={migration.migrationId}
          className="grid gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-modiff-text" title={migration.migrationId}>
                {migration.migrationId}
              </p>
              <p className="text-xs text-modiff-subtle-text">
                {migration.targets.length} targets · {stateLabel(migration.journalState)} journal
              </p>
            </div>
            <StatusActionChip
              label={stateLabel(migration.effectiveState)}
              tone={statusTone(migration.effectiveState)}
            />
          </div>
          <ul className="space-y-1">
            {migration.targets.map((target) => (
              <li key={target.sourcePath} className="flex min-w-0 items-start justify-between gap-2 text-xs">
                <span className="break-all font-mono text-modiff-text">{target.sourcePath}</span>
                <span
                  className={cx(
                    'shrink-0 font-semibold',
                    target.state === 'conflict' || target.state === 'missing'
                      ? 'text-modiff-red'
                      : target.state === 'applied'
                        ? 'text-modiff-green'
                        : 'text-modiff-subtle-text',
                  )}
                >
                  {target.state}
                </span>
              </li>
            ))}
          </ul>
          {migration.rollbackAvailable ? (
            <div>
              <ModiffButton
                size="compact"
                tone="secondary"
                icon={<RotateCcw size={14} />}
                loading={busyId === migration.migrationId}
                disabled={Boolean(busyId)}
                onClick={() => onInspectRollback(migration)}
                data-testid={`composite-migration-inspect-${migration.migrationId}`}
              >
                Review rollback
              </ModiffButton>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

export function CompositeMigrationRollbackReview({
  busy,
  confirmation,
  error,
  onCancel,
  onConfirmationChange,
  onRollback,
  status,
}: {
  busy: boolean;
  confirmation: string;
  error?: string | null;
  onCancel: () => void;
  onConfirmationChange: (value: string) => void;
  onRollback: () => void;
  status: CompositeMigrationStatus;
}) {
  return (
    <div className="grid gap-4" data-testid="composite-migration-rollback-review">
      <div className="rounded-modiff-compact border border-hf-orange/40 bg-hf-orange/5 p-3 text-xs leading-5 text-modiff-text">
        Rollback restores the exact backups for this journal. It refuses missing or independently changed files and has
        no force option.
      </div>
      <section className="grid gap-1.5">
        <h4 className="text-xs font-bold uppercase text-modiff-subtle-text">Exact files to restore</h4>
        <ul className="max-h-44 space-y-1 overflow-auto rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2">
          {status.targets.map((target) => (
            <li key={target.sourcePath} className="break-all font-mono text-xs text-modiff-text">
              {target.sourcePath} <span className="text-modiff-subtle-text">({target.state})</span>
            </li>
          ))}
        </ul>
      </section>
      <ModiffFieldShell
        label={
          <span>
            Type <code className="font-mono text-hf-yellow">{COMPOSITE_MIGRATION_ROLLBACK_CONFIRMATION}</code>
          </span>
        }
        required
        error={error ?? undefined}
      >
        <ModiffInput
          autoComplete="off"
          spellCheck={false}
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.currentTarget.value)}
          data-testid="composite-migration-rollback-confirmation"
        />
      </ModiffFieldShell>
      <div className="flex flex-wrap justify-end gap-2 border-t border-modiff-border pt-3">
        <ModiffButton disabled={busy} onClick={onCancel}>
          Cancel
        </ModiffButton>
        <ModiffButton
          tone="danger"
          loading={busy}
          disabled={busy || confirmation !== COMPOSITE_MIGRATION_ROLLBACK_CONFIRMATION}
          onClick={onRollback}
          data-testid="composite-migration-rollback"
        >
          Restore exact backups
        </ModiffButton>
      </div>
    </div>
  );
}

export function CompositeMigrationCard() {
  const hasDirtyWorkflow = useStudioStore((state) => state.workflowTabs.some(({ dirty }) => dirty));
  const [preview, setPreview] = useState<CompositeMigrationPreview | null>(null);
  const [migrations, setMigrations] = useState<CompositeMigrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recoveryAudit, setRecoveryAudit] = useState<LegacyClusterRecoveryAudit | null>(null);
  const [recoveryAuditLoading, setRecoveryAuditLoading] = useState(true);
  const [recoveryAuditError, setRecoveryAuditError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [compilerError, setCompilerError] = useState<string | null>(null);
  const [compilerSupplementText, setCompilerSupplementText] = useState('');
  const [compilerSupplement, setCompilerSupplement] = useState<RegisteredClusterCompilerSupplement | null>(null);
  const [compilerDiagnostics, setCompilerDiagnostics] = useState<RegisteredClusterCompilerDiagnostic[]>([]);
  const [compilerProgress, setCompilerProgress] = useState<RegisteredClusterCompilerProgress | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [applyConfirmation, setApplyConfirmation] = useState('');
  const [allowBlockedCandidates, setAllowBlockedCandidates] = useState(false);
  const [rollbackStatus, setRollbackStatus] = useState<CompositeMigrationStatus | null>(null);
  const [rollbackConfirmation, setRollbackConfirmation] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const refreshRevision = useRef(0);
  const recoveryAuditRevision = useRef(0);
  const compilerGenerationRevision = useRef(0);
  const compilerAbort = useRef<AbortController | null>(null);
  const mutationInFlight = useRef(false);
  const compilerSupplementRef = useRef<RegisteredClusterCompilerSupplement | null>(null);

  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    setLoading(true);
    try {
      const [nextPreview, nextJournals] = await Promise.all([
        fetchCompositeMigrationPreview(compilerSupplementRef.current ?? undefined),
        fetchCompositeMigrationList(),
      ]);
      if (revision !== refreshRevision.current) return;
      setPreview(nextPreview);
      setMigrations(nextJournals.migrations);
      setError(null);
    } catch (requestError) {
      if (revision === refreshRevision.current)
        setError(formatCompositeMigrationError(requestError, 'Could not inspect legacy composite migrations.'));
    } finally {
      if (revision === refreshRevision.current) setLoading(false);
    }
  }, []);

  const refreshRecoveryAudit = useCallback(async () => {
    const revision = ++recoveryAuditRevision.current;
    setRecoveryAuditLoading(true);
    try {
      const nextAudit = await fetchLegacyClusterRecoveryAudit();
      if (revision !== recoveryAuditRevision.current) return;
      setRecoveryAudit(nextAudit);
      setRecoveryAuditError(null);
    } catch (requestError) {
      if (revision === recoveryAuditRevision.current)
        setRecoveryAuditError(
          formatCompositeMigrationError(requestError, 'Could not inspect historical Cluster recovery evidence.'),
        );
    } finally {
      if (revision === recoveryAuditRevision.current) setRecoveryAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshRecoveryAudit();
    return () => {
      refreshRevision.current += 1;
      recoveryAuditRevision.current += 1;
      compilerGenerationRevision.current += 1;
      compilerAbort.current?.abort();
    };
  }, [refresh, refreshRecoveryAudit]);

  const runMutation = async (id: string, mutation: () => Promise<void>) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusyId(id);
    setActionError(null);
    try {
      await mutation();
    } catch (requestError) {
      const message = formatCompositeMigrationError(requestError, 'Composite migration action failed.');
      setActionError(message);
      setError(message);
      enqueueSnackbar(message, { variant: 'error' });
    } finally {
      mutationInFlight.current = false;
      setBusyId(null);
    }
  };

  const openReview = () => {
    if (!preview?.summary.hasChanges || (preview.compilerSupplement && !compilerSupplement)) return;
    setApplyConfirmation('');
    setAllowBlockedCandidates(false);
    setActionError(null);
    setReviewOpen(true);
  };

  const previewCompilerSupplement = () => {
    void runMutation('compiler-preview', async () => {
      let parsed: RegisteredClusterCompilerSupplement;
      try {
        parsed = parseRegisteredClusterCompilerSupplement(JSON.parse(compilerSupplementText));
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : 'Compiler supplement JSON is invalid.';
        setCompilerError(message);
        throw new Error(message);
      }
      const next = await fetchCompositeMigrationPreview(parsed);
      compilerSupplementRef.current = parsed;
      setCompilerSupplement(parsed);
      setPreview(next);
      setCompilerError(null);
      setError(null);
      enqueueSnackbar('Exact registered-Cluster compiler supplement previewed; no files were changed.', {
        variant: 'success',
      });
    });
  };

  const generateCompilerSupplement = () => {
    void runMutation('compiler-generate', async () => {
      const generation = ++compilerGenerationRevision.current;
      const abort = new AbortController();
      compilerAbort.current?.abort();
      compilerAbort.current = abort;
      setCompilerError(null);
      setCompilerDiagnostics([]);
      setCompilerProgress(null);
      try {
        // Refresh first so sourceSha256 and legacyCompositeHash come from the
        // exact backend-owned bytes used by this generation attempt. The final
        // supplemented POST repeats all validation and catches any source race.
        const sourcePreview = await fetchCompositeMigrationPreview();
        if (abort.signal.aborted || generation !== compilerGenerationRevision.current) return;
        const generated = await generateRegisteredClusterCompilerSupplement({
          candidates: sourcePreview.candidates,
          signal: abort.signal,
          onProgress: (progress) => {
            if (!abort.signal.aborted && generation === compilerGenerationRevision.current)
              setCompilerProgress(progress);
          },
        });
        if (abort.signal.aborted || generation !== compilerGenerationRevision.current) return;
        const serialized = JSON.stringify(generated.supplement, null, 2);
        setCompilerSupplementText(serialized);
        setCompilerDiagnostics(generated.diagnostics);
        if (!generated.conversionCount) {
          compilerSupplementRef.current = null;
          setCompilerSupplement(null);
          setPreview(sourcePreview);
          const message = generated.candidateCount
            ? `No legacy registered Cluster matched an exact current compiler route. Review ${generated.diagnostics.length} blocker${generated.diagnostics.length === 1 ? '' : 's'} below.`
            : 'No legacy registered Cluster candidates are present in saved workflows.';
          setCompilerError(message);
          enqueueSnackbar(message, { variant: 'warning' });
          return;
        }
        const parsed = parseRegisteredClusterCompilerSupplement(generated.supplement);
        const next = await fetchCompositeMigrationPreview(parsed);
        if (abort.signal.aborted || generation !== compilerGenerationRevision.current) return;
        compilerSupplementRef.current = parsed;
        setCompilerSupplement(parsed);
        setPreview(next);
        setError(null);
        enqueueSnackbar(
          `Generated and previewed ${generated.conversionCount} exact registered-Cluster conversion${generated.conversionCount === 1 ? '' : 's'}; no files were changed.`,
          { variant: 'success' },
        );
      } catch (generationError) {
        if (abort.signal.aborted || generation !== compilerGenerationRevision.current) {
          enqueueSnackbar('Compiler supplement generation cancelled; no files were changed.', { variant: 'info' });
          return;
        }
        throw generationError;
      } finally {
        if (compilerAbort.current === abort) compilerAbort.current = null;
      }
    });
  };

  const cancelCompilerGeneration = () => {
    compilerGenerationRevision.current += 1;
    compilerAbort.current?.abort();
    compilerAbort.current = null;
    setCompilerProgress(null);
  };

  const restoreDefaultPreview = () => {
    compilerSupplementRef.current = null;
    setCompilerSupplement(null);
    setCompilerSupplementText('');
    setCompilerError(null);
    setCompilerDiagnostics([]);
    setCompilerProgress(null);
    void refresh();
  };

  const applyReviewed = () => {
    if (!preview || !canApplyCompositeMigration(preview, applyConfirmation, allowBlockedCandidates)) return;
    void runMutation('apply', async () => {
      const result = await applyCompositeMigration(preview, {
        confirmation: applyConfirmation,
        allowBlockedCandidates,
        ...(compilerSupplement ? { compilerSupplement } : {}),
      });
      enqueueSnackbar(
        result.idempotent
          ? 'This exact migration was already applied.'
          : `Converted ${result.changedPaths?.length ?? 0} reviewed files and created exact backups.`,
        { variant: 'success' },
      );
      setReviewOpen(false);
      setApplyConfirmation('');
      setAllowBlockedCandidates(false);
      compilerSupplementRef.current = null;
      setCompilerSupplement(null);
      setCompilerSupplementText('');
      setCompilerDiagnostics([]);
      setCompilerProgress(null);
      await refresh();
    });
  };

  const inspectRollback = (summary: CompositeMigrationStatus) => {
    void runMutation(summary.migrationId, async () => {
      const exact = await fetchCompositeMigrationStatus(summary.migrationId);
      setRollbackStatus(exact);
      setRollbackConfirmation('');
      setActionError(null);
    });
  };

  const rollbackReviewed = () => {
    if (!rollbackStatus || rollbackConfirmation !== COMPOSITE_MIGRATION_ROLLBACK_CONFIRMATION) return;
    void runMutation(rollbackStatus.migrationId, async () => {
      const result = await rollbackCompositeMigration(rollbackStatus.migrationId, rollbackConfirmation);
      enqueueSnackbar(
        result.idempotent
          ? 'This migration was already rolled back.'
          : `Restored ${result.restoredPaths?.length ?? 0} files from exact backups.`,
        { variant: 'success' },
      );
      setRollbackStatus(null);
      setRollbackConfirmation('');
      await refresh();
    });
  };

  const blockers = preview?.summary.blockedCandidateCount ?? 0;
  return (
    <section
      className="grid gap-3 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3"
      data-testid="composite-migration-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={15} className="text-hf-yellow" />
          <div>
            <h3 className="text-sm font-bold text-modiff-text">Legacy composite migration</h3>
            <p className="text-xs text-modiff-subtle-text">Read-only preview and exact-backup recovery</p>
          </div>
        </div>
        <StatusActionChip
          label={loading && !preview ? 'Checking' : blockers ? `${blockers} blocked` : 'Reviewed'}
          tone={error ? 'error' : blockers ? 'warning' : preview ? 'success' : 'neutral'}
        />
      </div>
      <p className="text-xs leading-5 text-modiff-subtle-text">
        Previewing writes nothing. Apply and rollback are available only after reviewing exact paths and typing the
        required literal confirmation.
      </p>
      {error ? (
        <div className="flex items-start gap-2 rounded-modiff-compact border border-modiff-red/40 bg-modiff-red/5 p-2 text-xs text-modiff-red">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      ) : null}
      {preview ? (
        <ModiffDisclosure
          label={
            <span className="flex items-center gap-2">
              <FileClock size={14} className="text-hf-yellow" />
              Current read-only preview
            </span>
          }
          className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-2"
          buttonClassName="p-0"
          panelClassName="mt-3"
          data-testid="composite-migration-preview-disclosure"
        >
          <CompositeMigrationPreviewDetails preview={preview} />
        </ModiffDisclosure>
      ) : !loading && !error ? (
        <p className="text-xs text-modiff-subtle-text">No migration preview is available.</p>
      ) : null}
      <ModiffDisclosure
        label={
          <span className="flex items-center gap-2">
            <FileClock size={14} className="text-hf-orange" />
            Historical definition recovery evidence
          </span>
        }
        className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-2"
        buttonClassName="p-0"
        panelClassName="mt-3"
        data-testid="legacy-cluster-recovery-evidence-disclosure"
      >
        <LegacyClusterRecoveryEvidencePanel
          audit={recoveryAudit}
          error={recoveryAuditError}
          loading={recoveryAuditLoading}
          onRefresh={() => void refreshRecoveryAudit()}
        />
      </ModiffDisclosure>
      <ModiffDisclosure
        label="Registered Cluster compiler supplement"
        className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-2"
        buttonClassName="p-0"
        panelClassName="mt-3"
        data-testid="composite-migration-compiler-disclosure"
      >
        <div className="grid gap-3">
          <p className="text-xs leading-5 text-modiff-subtle-text">
            Generate exact compiler evidence from saved legacy Clusters, or paste externally produced evidence below.
            Generation and preview are read-only. The exact parsed supplement is retained only for this reviewed preview
            and resent unchanged on Apply.
          </p>
          {hasDirtyWorkflow ? (
            <div
              className="flex items-start gap-2 rounded-modiff-compact border border-hf-orange/40 bg-hf-orange/5 p-2 text-xs text-hf-orange"
              data-testid="composite-migration-unsaved-warning"
            >
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                Generation reads saved backend workflow bytes only. Save dirty workflow tabs first if their current
                canvas changes should be included.
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <ModiffButton
              size="compact"
              tone="primary"
              icon={<Sparkles size={14} />}
              loading={busyId === 'compiler-generate'}
              disabled={Boolean(busyId)}
              onClick={generateCompilerSupplement}
              data-testid="composite-migration-compiler-generate"
            >
              Generate exact supplement
            </ModiffButton>
            {busyId === 'compiler-generate' ? (
              <ModiffButton
                size="compact"
                tone="secondary"
                onClick={cancelCompilerGeneration}
                data-testid="composite-migration-compiler-cancel"
              >
                Cancel generation
              </ModiffButton>
            ) : null}
            {compilerProgress ? (
              <span className="text-xs text-modiff-subtle-text" data-testid="composite-migration-compiler-progress">
                Reviewed {compilerProgress.completed}/{compilerProgress.total} saved Cluster candidates
              </span>
            ) : null}
          </div>
          {compilerDiagnostics.length ? (
            <section
              className="grid gap-1.5 rounded-modiff-compact border border-hf-orange/40 bg-hf-orange/5 p-2"
              data-testid="composite-migration-compiler-diagnostics"
            >
              <h4 className="text-xs font-bold uppercase text-hf-orange">
                Candidates left unchanged ({compilerDiagnostics.length})
              </h4>
              <ul className="max-h-40 space-y-2 overflow-auto">
                {compilerDiagnostics.map((diagnostic, index) => (
                  <li
                    key={`${diagnostic.sourcePath}:${diagnostic.instanceId ?? ''}:${diagnostic.code}:${index}`}
                    className="text-xs"
                  >
                    <p className="break-all font-mono text-modiff-text">
                      {diagnostic.sourcePath}
                      {diagnostic.instanceId ? ` · ${diagnostic.instanceId}` : ''}
                    </p>
                    <p className="text-modiff-subtle-text">
                      {diagnostic.code}: {diagnostic.message}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <ModiffFieldShell
            label="Compiler supplement JSON"
            error={compilerError ?? undefined}
            description="Presentation children never become execution authority; the backend verifies pinned V2 definitions and every preservation receipt."
          >
            <ModiffTextarea
              value={compilerSupplementText}
              onChange={(event) => {
                setCompilerSupplementText(event.target.value);
                setCompilerError(null);
                setCompilerDiagnostics([]);
                setCompilerProgress(null);
                if (compilerSupplementRef.current) {
                  compilerSupplementRef.current = null;
                  setCompilerSupplement(null);
                  setPreview(null);
                  void refresh();
                }
              }}
              rows={8}
              spellCheck={false}
              disabled={Boolean(busyId)}
              className="font-mono text-xs"
              placeholder='{"schemaVersion":1,"kind":"registered_cluster_v2_compiler_supplement","compilerOutputs":[]}'
              data-testid="composite-migration-compiler-json"
            />
          </ModiffFieldShell>
          <div className="flex flex-wrap gap-2">
            <ModiffButton
              size="compact"
              tone="primary"
              loading={busyId === 'compiler-preview'}
              disabled={Boolean(busyId) || !compilerSupplementText.trim()}
              onClick={previewCompilerSupplement}
              data-testid="composite-migration-compiler-preview"
            >
              Preview exact supplement
            </ModiffButton>
            <ModiffButton
              size="compact"
              tone="secondary"
              disabled={Boolean(busyId) || !compilerSupplement}
              onClick={restoreDefaultPreview}
              data-testid="composite-migration-compiler-clear"
            >
              Return to default preview
            </ModiffButton>
          </div>
        </div>
      </ModiffDisclosure>
      <div className="flex flex-wrap gap-2">
        <ModiffButton
          size="compact"
          tone="primary"
          disabled={
            loading ||
            Boolean(busyId) ||
            !preview?.summary.hasChanges ||
            Boolean(preview.compilerSupplement && !compilerSupplement)
          }
          onClick={openReview}
          data-testid="composite-migration-review"
        >
          Review migration
        </ModiffButton>
        <ModiffButton
          size="compact"
          tone="secondary"
          icon={<RefreshCw size={14} />}
          loading={loading}
          disabled={loading || Boolean(busyId)}
          onClick={() => void refresh()}
          data-testid="composite-migration-refresh"
        >
          Refresh preview
        </ModiffButton>
      </div>
      <ModiffDisclosure
        label={`Recovery journals (${migrations.length})`}
        className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-2"
        buttonClassName="p-0"
        panelClassName="mt-3"
        data-testid="composite-migration-recovery-disclosure"
      >
        <CompositeMigrationRecoveryList migrations={migrations} busyId={busyId} onInspectRollback={inspectRollback} />
      </ModiffDisclosure>
      <ModiffDialog
        open={reviewOpen && Boolean(preview)}
        onClose={() => {
          if (!busyId) setReviewOpen(false);
        }}
        title="Review legacy composite migration"
        description="Only the listed files can change. Exact backups are created before migration."
        panelClassName="max-w-4xl"
        dismissible={!busyId}
        testId="composite-migration-review-dialog"
      >
        {preview ? (
          <CompositeMigrationApplyReview
            preview={preview}
            confirmation={applyConfirmation}
            allowBlockedCandidates={allowBlockedCandidates}
            busy={busyId === 'apply'}
            error={actionError}
            onConfirmationChange={setApplyConfirmation}
            onAllowBlockedCandidatesChange={setAllowBlockedCandidates}
            onCancel={() => setReviewOpen(false)}
            onApply={applyReviewed}
          />
        ) : null}
      </ModiffDialog>
      <ModiffDialog
        open={Boolean(rollbackStatus)}
        onClose={() => {
          if (!busyId) setRollbackStatus(null);
        }}
        title="Review exact-backup rollback"
        description="Restore the exact backed-up files. Review conflicts before confirming rollback."
        panelClassName="max-w-3xl"
        dismissible={!busyId}
        testId="composite-migration-rollback-dialog"
      >
        {rollbackStatus ? (
          <CompositeMigrationRollbackReview
            status={rollbackStatus}
            confirmation={rollbackConfirmation}
            busy={busyId === rollbackStatus.migrationId}
            error={actionError}
            onConfirmationChange={setRollbackConfirmation}
            onCancel={() => setRollbackStatus(null)}
            onRollback={rollbackReviewed}
          />
        ) : null}
      </ModiffDialog>
    </section>
  );
}
