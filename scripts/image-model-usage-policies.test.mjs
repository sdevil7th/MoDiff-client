import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, policies, profiles, templates, artifactCatalog, captionProvenance;

before(async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.window = { location: { origin: 'http://localhost' }, localStorage: globalThis.localStorage };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  policies = await server.ssrLoadModule('/src/studio/modelUsagePolicies.ts');
  profiles = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  templates = await server.ssrLoadModule('/src/studio/templates.ts');
  artifactCatalog = JSON.parse(await readFile('../MoDiff/data/model-artifact-catalog.json', 'utf8'));
  captionProvenance = JSON.parse(
    await readFile('../MoDiff/data/cosmos3-super-t2i-publisher-caption-provenance.v1.json', 'utf8'),
  );
});

after(async () => server?.close());

test('full FLUX2 dev terms are distinct from FLUX1 and bind to the reviewed artifact', () => {
  const policy = policies.usagePolicyForRepository(profiles.FLUX2_DEV_REPO);
  const pin = artifactCatalog.repositoryPins.find((item) => item.repo === profiles.FLUX2_DEV_REPO);
  assert.equal(policy.reviewedRevision, pin.revision);
  assert.equal(pin.license, 'flux-non-commercial-license');
  assert.equal(policy.acknowledgementRequired, true);
  assert.equal(policy.useScope, 'license_review_required');
  assert.equal(policy.access, 'huggingface_gated');
  assert.match(policy.shortSummary, /v2\.1/);
  assert.match(policy.shortSummary, /non-commercial, non-production/);
  assert.match(policy.shortSummary, /filtering or manual review/);
  assert.doesNotMatch(policy.shortSummary, /FLUX\.1/);
  assert.equal(policy.termsUrl, `https://huggingface.co/${pin.repo}/blob/${pin.revision}/LICENSE.md`);
  assert.notEqual(policy.id, policies.usagePolicyForRepository(profiles.FLUX_DEV_REPO).id);
  assert.equal(policies.repositoryRequiresHuggingFaceGate(pin.repo), true);
});

test('Cosmos Super uses its public OpenMDW terms while mandatory Guardrail keeps separate gated terms', async () => {
  const policy = policies.usagePolicyForRepository(profiles.COSMOS3_SUPER_T2I_REPO);
  const pin = artifactCatalog.repositoryPins.find((item) => item.repo === policy.repository);
  assert.equal(policy.reviewedRevision, pin.revision);
  assert.equal(policy.reviewedRevision, captionProvenance.revision);
  assert.equal(pin.license, 'openmdw-1.1');
  assert.equal(policy.termsUrl, captionProvenance.publisherLicenseUrl);
  const license = await readFile(`../MoDiff/${captionProvenance.licenseFile}`);
  assert.equal(createHash('sha256').update(license).digest('hex'), captionProvenance.licenseFileSha256);
  assert.equal(policy.access, 'public');
  assert.equal(policy.useScope, 'commercial_allowed');
  assert.equal(policy.acknowledgementRequired, true);
  assert.equal(policies.repositoryRequiresHuggingFaceGate(pin.repo), false);
  assert.match(policy.shortSummary, /license and applicable origin notices/);
  assert.match(policy.shortSummary, /no output-use restrictions/);
  const guardrail = policies.usagePolicyForRepository(profiles.COSMOS3_GUARDRAIL_REPO);
  assert.equal(guardrail.access, 'huggingface_gated');
  assert.equal(guardrail.useScope, 'license_review_required');
  assert.notEqual(policy.id, guardrail.id);
  assert.notEqual(policy.termsUrl, guardrail.termsUrl);
});

test('exact full-model template/install acknowledgements match and change on artifact or policy drift', () => {
  for (const id of ['flux2_dev_text_to_image', 'cosmos3_super_text_to_image']) {
    const template = templates.STUDIO_TEMPLATES.find((item) => item.id === id);
    assert.ok(template);
    assert.equal(template.example.status, 'unverified');
    assert.equal(
      templates.STUDIO_TEMPLATES.some((item) => item.id === id),
      true,
    );
    const required = policies.acknowledgementRequiredForTemplate(template);
    const base = required.find((item) => item.repository === template.modelArtifact.value);
    assert.ok(base, 'Create must review the exact selected full model, not the static family default.');
    assert.equal(base.revision, template.modelArtifact.revision);
    const install = policies.acknowledgementRequiredForRepository(base.repository, base.revision);
    const key = policies.usagePolicyAcknowledgementKey([base]);
    assert.equal(key, policies.usagePolicyAcknowledgementKey(install));
    assert.notEqual(key, policies.usagePolicyAcknowledgementKey([{ ...base, revision: 'f'.repeat(40) }]));
    assert.notEqual(key, policies.usagePolicyAcknowledgementKey([{ ...base, policyVersion: 'changed' }]));
    if (id === 'cosmos3_super_text_to_image')
      assert.ok(required.some((item) => item.repository === profiles.COSMOS3_GUARDRAIL_REPO));
  }
  assert.ok(
    policies
      .acknowledgementRequiredForModelRun({ modelType: 'Flux2ModularPipeline', mode: 'text_to_image' })
      .some((item) => item.repository === profiles.FLUX2_DEV_REPO),
  );
});
