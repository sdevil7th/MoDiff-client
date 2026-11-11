import { backendSourceEvidence, normalizeBackendRuntime } from './live-proof-provenance.mjs';

export function assertHardwareRuntimeMatches(observed, health, provenance) {
  const reported = typeof observed === 'string' ? observed : observed?.fingerprint;
  if (
    Array.isArray(observed) ||
    typeof reported !== 'string' ||
    !reported.trim() ||
    typeof health?.runtime_fingerprint !== 'string' ||
    !health.runtime_fingerprint.trim()
  )
    throw new Error('Gallery run or current backend is missing a runtime fingerprint.');

  if (observed && typeof observed === 'object' && Object.hasOwn(observed, 'resourceFingerprint')) {
    // Health reports the resource domain. Retain the separate execution domain
    // and prove its source and normalized runtime; never substitute one hash.
    if (
      typeof observed.resourceFingerprint !== 'string' ||
      !observed.resourceFingerprint.trim() ||
      health.runtime_fingerprint !== observed.resourceFingerprint
    ) {
      throw new Error('Current backend runtime does not match the completed gallery run.');
    }
    if (
      provenance?.runtime?.reportedFingerprint !== reported ||
      normalizeBackendRuntime(observed, provenance?.runtime?.deterministic?.settings).lockFingerprint !==
        provenance?.runtimeFingerprint
    ) {
      throw new Error('Gallery execution runtime does not match retained provenance.');
    }
    const source = provenance?.runtime?.backendSource;
    for (const runtimeFingerprint of [observed, { backendSource: health?.backend_source }]) {
      const evidence = backendSourceEvidence({ before: source, after: source, runtimeFingerprint });
      if (evidence.blockers.length)
        throw new Error(`Gallery hardware source does not match: ${evidence.blockers.join(' ')}`);
    }
    return;
  }
  if (health.runtime_fingerprint !== reported) {
    throw new Error('Current backend runtime does not match the completed gallery run.');
  }
}
