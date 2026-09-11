import { AlertTriangle, ExternalLink } from 'lucide-react';
import type { ResolvedModelUsagePolicy } from '../studio/modelUsagePolicies';
import { ModiffButton, ModiffDialog } from '../ui';

function scopeLabel(policy: ResolvedModelUsagePolicy) {
  if (policy.useScope === 'personal_noncommercial') return 'Personal / non-commercial';
  if (policy.useScope === 'research_academic_only') return 'Research / academic only';
  if (policy.useScope === 'noncommercial_only') return 'Restricted model license';
  if (policy.useScope === 'license_review_required') return 'Product and user review required';
  if (policy.useScope === 'rights_undetermined') return 'No weight license declared';
  return 'Usage terms';
}

export function TemplateUsageTermsDialog({
  open,
  policies,
  action,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  policies: readonly ResolvedModelUsagePolicy[];
  action: 'create' | 'install' | 'run';
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isModelRun = action === 'run';
  const hasUndeterminedRights = policies.some((policy) => policy.useScope === 'rights_undetermined');
  return (
    <ModiffDialog
      open={open}
      onClose={onCancel}
      testId={isModelRun ? 'model-usage-terms-dialog' : 'template-usage-terms-dialog'}
      title={
        <span className="inline-flex items-center gap-2">
          <AlertTriangle aria-hidden="true" className="text-hf-yellow" size={18} />
          Review model terms
        </span>
      }
      panelClassName="max-w-xl"
      footer={
        <>
          <ModiffButton onClick={onCancel}>Cancel</ModiffButton>
          <ModiffButton
            tone="primary"
            onClick={onConfirm}
            data-testid={isModelRun ? 'model-usage-terms-confirm' : 'template-usage-terms-confirm'}
          >
            {isModelRun ? 'I acknowledge' : hasUndeterminedRights ? 'I understand' : 'I have reviewed and agree'} —{' '}
            {action === 'install' ? 'Install' : action === 'run' ? 'Run' : 'Create graph'}
          </ModiffButton>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm leading-5 text-modiff-subtle-text">
          This {isModelRun ? 'model run' : 'template'} uses {policies.length} model{' '}
          {policies.length === 1 ? 'dependency' : 'dependencies'} with usage restrictions. Review the original terms
          before{' '}
          {action === 'install'
            ? 'installing its models'
            : action === 'run'
              ? 'running the workflow'
              : 'creating the graph'}
          .
        </p>
        <div className="grid gap-2">
          {policies.map((policy) => (
            <section
              key={`${policy.id}:${policy.revision ?? ''}`}
              className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="break-words text-sm font-semibold text-modiff-text">{policy.repository}</div>
                  <div className="mt-1 text-xs font-semibold text-hf-yellow">{scopeLabel(policy)}</div>
                  <p className="mt-1 text-xs leading-5 text-modiff-subtle-text">{policy.shortSummary}</p>
                </div>
                <a
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-modiff-blue hover:underline"
                  href={policy.termsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View terms
                  <ExternalLink aria-hidden="true" size={12} />
                </a>
              </div>
              {policy.access === 'huggingface_gated' ? (
                <a
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-modiff-blue hover:underline"
                  href={policy.modelCardUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open on Hugging Face to request or review access
                  <ExternalLink aria-hidden="true" size={12} />
                </a>
              ) : null}
            </section>
          ))}
        </div>
        <p className="text-xs leading-5 text-modiff-subtle-text">
          MoDiff does not grant model-use rights. This acknowledgement does not change or replace the model authors’
          terms.
        </p>
      </div>
    </ModiffDialog>
  );
}
