# `brevess-library-transfer-v1`

This is a portable metadata transfer format for BREVESS radar tasks and the
global library view.

## Guarantees

- No API keys, passwords, cookies, browser profile data or authorization
  headers are exported.
- No PDF bytes, Base64 blobs, data URLs, `localStorage` dumps or full-text
  claims are exported. `sourceDocuments` is a list of availability/provenance
  metadata only.
- Envelope keys are allowlisted by the domain modules. `__proto__`,
  `constructor`, `prototype`, sensitive keys and binary keys fail closed.
- The envelope is bounded to 16 MiB, 50 radars, 5,000 radar articles per
  revision, and 5,000 global entries. The optional FNV-1a digest detects
  accidental or simple tampering; it is not a cryptographic signature.
- Radar import writes through `createRadarStore().transact`, so merge, audit,
  transfer revision and idempotency receipt commit atomically.

## Modules

`core/library-transfer.js`

- `validateEnvelope(bundle, { expectedKind })`
- `makeEnvelope({ kind, payload, generatedAt, source })`
- `combineTransfers(radarBundle, globalBundle)`
- `splitCombinedTransfer(bundle)`
- `identityKey(entry)`
- `digest(value)`

`core/literature-radar-transfer.js`

- `exportRadarTransfer(state, { radarIds, includeRevisions, now })`
- `mergeRadarTransfer(state, bundle, { now })`
- `createRadarTransferService({ store, now, audit })`
  - `export(options)`
  - `import(bundle, { idempotencyKey, expectedTransferRevision })`

`workbench/global-library-transfer.js`

- `exportGlobalLibraryTransfer(entries, { now })`
- `mergeGlobalLibraryTransfer(existingEntries, bundle, { now })`
- `createGlobalLibraryTransferService({ readEntries, commitEntries, now, audit })`
  - `export()`
  - `import(bundle, { idempotencyKey })`

The global service expects `commitEntries(nextEntries, receipt)` to be an
atomic caller-owned commit. The Workbench can persist the merged view or pass
it through its own library index; this module never writes radar state.

For a browser Workbench page, load in this order after the existing radar and
global-library modules:

```html
<script src="../core/library-transfer.js"></script>
<script src="../core/literature-radar-transfer.js"></script>
<script src="../workbench/global-library-transfer.js"></script>
```

The Workbench owner controls the actual UI buttons and import/export dialogs;
these modules intentionally do not edit `workbench/app.js`.

MCP adapters are exposed as `library.export_transfer` and
`library.import_transfer`. They route to the Workbench host methods
`exportLibraryTransfer` and `importLibraryTransfer`; until those methods are
wired, the bridge returns `MCP_WORKBENCH_TRANSFER_HOST_UNAVAILABLE` rather than
touching IndexedDB or claiming a transfer completed.

## Merge keys

Identity precedence is:

1. PMID
2. normalized DOI
3. NFKC normalized title with punctuation/whitespace removed

Radar tasks match by `source + normalized query + baselineDays`. An import
never overwrites an existing radar with a different query. Existing task
settings are preserved and a `RADAR_TRANSFER_QUERY_CONFLICT` warning/conflict is
returned. For the global view, existing metadata wins on metadata conflict;
tags and sourceDocuments are unioned; `read`, availability and status are
merged with stronger values retained.

## Examples

- `radar.example.json`
- `global-library.example.json`
- `brevess-library-transfer-v1.schema.json`

`makeEnvelope` computes the digest and `validateEnvelope` rejects a stale
digest; the checked-in examples carry their matching digests.
