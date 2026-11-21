export function captureQualificationStatus(supportTier) {
  return supportTier === 'supported' ? 'qualified' : 'observed';
}

export function hardwareExecutionDevice(health, provenance) {
  const profile = health?.runtime_profile?.installed;
  const measurement = provenance?.execution?.measurement;
  const measuredDevice = measurement?.device;
  const backend = measurement?.backend;
  const expected = {
    'nvidia-cuda': ['cuda', 'cuda'],
    'amd-rocm-linux': ['cuda', 'rocm'],
    'amd-instinct-rocm-linux': ['cuda', 'rocm'],
    'amd-pytorch-windows': ['cuda', 'rocm'],
    'intel-xpu': ['xpu', 'xpu'],
    'apple-mps': ['mps', 'mps'],
    cpu: ['cpu', 'cpu'],
  }[profile];
  if (!expected) throw new Error('Hardware evidence has no reviewed runtime profile.');
  const match = typeof measuredDevice === 'string' ? /^(cpu|cuda|xpu|mps)(?::([0-9]+))?$/.exec(measuredDevice) : null;
  if (!match || match[1] !== expected[0] || backend !== expected[1]) {
    throw new Error('Executed device/backend does not match the recorded hardware profile.');
  }
  const index = Number(match[2] ?? 0);
  if (!Number.isSafeInteger(index) || (['cpu', 'mps'].includes(match[1]) && index !== 0)) {
    throw new Error('Executed device index is invalid.');
  }
  if (profile === 'cpu') return { name: 'cpu', backend: 'cpu', vendor: null, total_memory: null };
  const devices = health?.packages?.torch?.[`${match[1]}_devices`];
  const device = Array.isArray(devices) ? devices.find((item) => item?.index === index) : null;
  if (!device || typeof device.name !== 'string' || !device.name.trim() || device.backend !== backend) {
    throw new Error('Executed accelerator is missing or inconsistent in captured physical device metadata.');
  }
  return device;
}

export function hardwareReceiptQualifies(receipt, profileId, manifestRevision) {
  return (
    receipt?.status === 'qualified' &&
    receipt?.supportTierAtCapture === 'supported' &&
    receipt?.profileId === profileId &&
    typeof manifestRevision === 'string' &&
    manifestRevision.length > 0 &&
    receipt?.manifestRevision === manifestRevision
  );
}

export function hardwareReceiptIsCurrent(receipt, manifestRevision) {
  return (
    ['qualified', 'observed'].includes(receipt?.status) &&
    typeof receipt?.profileId === 'string' &&
    receipt.profileId.length > 0 &&
    typeof manifestRevision === 'string' &&
    manifestRevision.length > 0 &&
    receipt?.manifestRevision === manifestRevision
  );
}

export function evaluateSupportedProfileCoverage(runtimeProfiles, receipts, manifestRevision) {
  const advertisedSupportedProfiles = Object.entries(runtimeProfiles ?? {})
    .filter(([, profile]) => profile?.tier === 'supported')
    .map(([id]) => id)
    .sort();
  const physicallyQualifiedProfiles = advertisedSupportedProfiles.filter((profileId) =>
    (receipts ?? []).some((receipt) => hardwareReceiptQualifies(receipt, profileId, manifestRevision)),
  );
  const unqualifiedSupportedProfiles = advertisedSupportedProfiles.filter(
    (profileId) => !physicallyQualifiedProfiles.includes(profileId),
  );
  const physicallyObservedProfiles = [
    ...new Set(
      (receipts ?? [])
        .filter((receipt) => hardwareReceiptIsCurrent(receipt, manifestRevision))
        .map((receipt) => receipt.profileId),
    ),
  ].sort();
  const profileTiers = Object.fromEntries(
    Object.entries(runtimeProfiles ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([profileId, profile]) => [profileId, profile?.tier ?? 'unqualified']),
  );
  return {
    advertisedSupportedProfiles,
    physicallyQualifiedProfiles,
    physicallyObservedProfiles,
    unqualifiedSupportedProfiles,
    profileTiers,
    hasSupportedProfile: advertisedSupportedProfiles.length > 0,
    allSupportedProfilesQualified: advertisedSupportedProfiles.length > 0 && unqualifiedSupportedProfiles.length === 0,
  };
}

function countRecipeStatus(recipes) {
  const qualified = recipes.filter((recipe) => recipe.status === 'qualified').length;
  return {
    required: recipes.length,
    qualified,
    missing: recipes.length - qualified,
  };
}

export function classifyResourceRecipeReleaseLanes(recipes, releaseEligibleTemplateIds) {
  const eligibleIds =
    releaseEligibleTemplateIds instanceof Set ? releaseEligibleTemplateIds : new Set(releaseEligibleTemplateIds ?? []);
  const classified = recipes.map((recipe) => ({
    ...recipe,
    releaseLane: (recipe.templates ?? []).some((templateId) => eligibleIds.has(templateId))
      ? 'release_eligible'
      : 'deferred',
  }));
  return {
    recipes: classified,
    coverage: {
      releaseEligible: countRecipeStatus(classified.filter((recipe) => recipe.releaseLane === 'release_eligible')),
      deferred: countRecipeStatus(classified.filter((recipe) => recipe.releaseLane === 'deferred')),
    },
  };
}
