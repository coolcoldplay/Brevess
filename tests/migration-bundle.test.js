const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  MIGRATION_BUNDLE_KIND,
  createMigrationBundle,
  validateMigrationBundle
} = require('../core/migration-bundle.js');
const { toPublicSettings } = require('../core/settings-store.js');

function migrationInput() {
  return {
    exportedAt: '2026-07-17T10:00:00.000Z',
    extensionVersion: '2.1.0',
    settings: {
      version: 5,
      mode: 'llm',
      API_KEY: 'top-level-secret',
      futureAuth: {
        custom_headers: { Authorization: 'non-profile-header-secret' },
        nested: [{ apiKey: 'array-api-secret', keep: 'safe-array-setting' }],
        keep: { enabled: true }
      },
      globalProfileId: 'profile_portable_gateway',
      profileOrder: ['profile_portable_gateway'],
      profiles: {
        profile_portable_gateway: {
          name: 'Portable gateway',
          providerId: 'openai-compatible',
          config: {
            apiKey: 'sk-portable-secret',
            model: 'custom-model',
            baseUrl: 'https://gateway.example/v1',
            authHeader: 'X-API-Key',
            authPrefix: '',
            customHeaders: { 'X-Portable-Secret': 'portable-header-secret' },
            futureAuth: {
              apiKey: 'nested-api-secret',
              safeUnknown: { keep: true },
              chain: [{
                Api_Key: 'nested-case-secret',
                'CUSTOM-HEADERS': { Authorization: 'nested-header-secret' },
                keep: 'safe-array-value'
              }]
            }
          },
          capabilities: { vision: false },
          tokenPolicy: { mode: 'auto', autoCap: null, manualMax: null }
        }
      },
      taskRoutes: {
        highlight: { mode: 'global', profileId: null },
        summary: { mode: 'global', profileId: null },
        figure: { mode: 'global', profileId: null },
        crossFigure: { mode: 'global', profileId: null }
      },
      selectedCategoryIds: ['key_result'],
      customCategories: [{ categoryId: 'custom_result', name: 'Custom result' }]
    },
    documents: {
      schemaVersion: 1,
      index: [{ documentId: `sha256:${'d'.repeat(64)}`, annotationCount: 1 }],
      documents: [{
        schemaVersion: 1,
        documentId: `sha256:${'d'.repeat(64)}`,
        title: 'Saved document',
        canonicalUrl: 'https://example.org/doc',
        studyType: 'narrative_review',
        annotations: [],
        revision: 1,
        updatedAt: '2026-07-17T09:00:00.000Z'
      }]
    },
    feedbackSamples: [{
      sampleId: 'sample-1', documentHash: 'hash-1', paragraphId: 'p1',
      categoryId: 'key_result', userAction: 'accepted'
    }]
  };
}

test('complete migration bundle preserves profile credentials while public settings remove them', () => {
  const bundle = createMigrationBundle(migrationInput());
  assert.equal(bundle.kind, MIGRATION_BUNDLE_KIND);
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.containsSecrets, true);
  assert.equal(
    bundle.settings.profiles.profile_portable_gateway.config.apiKey,
    'sk-portable-secret'
  );
  assert.equal(
    bundle.settings.profiles.profile_portable_gateway.config.customHeaders['X-Portable-Secret'],
    'portable-header-secret'
  );
  assert.equal(
    bundle.settings.profiles.profile_portable_gateway.config.futureAuth.apiKey,
    'nested-api-secret'
  );
  assert.equal(bundle.settings.API_KEY, 'top-level-secret');
  assert.equal(
    bundle.settings.futureAuth.custom_headers.Authorization,
    'non-profile-header-secret'
  );
  assert.equal(bundle.settings.customCategories[0].categoryId, 'custom_result');
  assert.equal(bundle.documents.documents[0].title, 'Saved document');
  assert.equal(bundle.feedbackSamples[0].sampleId, 'sample-1');
  assert.deepEqual(validateMigrationBundle(JSON.parse(JSON.stringify(bundle))), bundle);

  const publicSettings = toPublicSettings(bundle.settings);
  const serializedPublic = JSON.stringify(publicSettings);
  assert.equal(serializedPublic.includes('sk-portable-secret'), false);
  assert.equal(serializedPublic.includes('portable-header-secret'), false);
  assert.equal(serializedPublic.includes('nested-api-secret'), false);
  assert.equal(serializedPublic.includes('nested-case-secret'), false);
  assert.equal(serializedPublic.includes('nested-header-secret'), false);
  assert.equal(serializedPublic.includes('top-level-secret'), false);
  assert.equal(serializedPublic.includes('non-profile-header-secret'), false);
  assert.equal(serializedPublic.includes('array-api-secret'), false);
  assert.equal(
    publicSettings.profiles.profile_portable_gateway.config.hasApiKey,
    true
  );
  assert.deepEqual(
    publicSettings.profiles.profile_portable_gateway.config.customHeaderNames,
    ['X-Portable-Secret']
  );
  assert.deepEqual(
    publicSettings.profiles.profile_portable_gateway.config.futureAuth,
    {
      safeUnknown: { keep: true },
      chain: [{ keep: 'safe-array-value' }]
    }
  );
  assert.equal(
    bundle.settings.profiles.profile_portable_gateway.config.futureAuth.apiKey,
    'nested-api-secret'
  );
  assert.deepEqual(publicSettings.futureAuth, {
    nested: [{ keep: 'safe-array-setting' }],
    keep: { enabled: true }
  });
  assert.equal(bundle.settings.API_KEY, 'top-level-secret');
});

test('migration validation rejects unsupported, malformed, and oversized files', () => {
  const valid = createMigrationBundle(migrationInput());
  assert.throws(
    () => validateMigrationBundle({ ...valid, schemaVersion: 4 }),
    /INVALID_MIGRATION_SCHEMA/
  );
  assert.throws(
    () => createMigrationBundle({ ...migrationInput(), settings: null }),
    /INVALID_MIGRATION_SETTINGS/
  );
  assert.throws(
    () => createMigrationBundle({
      ...migrationInput(),
      settings: { huge: 'x'.repeat(26 * 1024 * 1024) }
    }),
    /MIGRATION_BUNDLE_TOO_LARGE/
  );
});

test('service worker and settings page expose full migration import and export controls', () => {
  const root = join(__dirname, '..');
  const background = readFileSync(join(root, 'background.js'), 'utf8');
  const router = readFileSync(join(root, 'core', 'background-router.js'), 'utf8');
  const html = readFileSync(join(root, 'options.html'), 'utf8');
  const script = readFileSync(join(root, 'options.js'), 'utf8');

  assert.match(background, /core\/migration-bundle\.js/);
  assert.match(background, /'MIGRATION_EXPORT'/);
  assert.match(background, /'MIGRATION_IMPORT'/);
  assert.match(router, /message\.type === 'MIGRATION_EXPORT'/);
  assert.match(router, /message\.type === 'MIGRATION_IMPORT'/);
  assert.match(html, /id="exportMigrationBundle"/);
  assert.match(html, /id="importMigrationBundle"/);
  assert.match(html, /API Key/);
  assert.match(script, /async function exportMigrationBundle/);
  assert.match(script, /async function importMigrationBundle/);
});
