export function captureQualificationStatus(supportTier) {
  return supportTier === 'supported' ? 'qualified' : 'observed';
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
