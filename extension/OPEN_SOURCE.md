# Open-source release policy

## License

Brevess is free software licensed under
[GNU AGPL-3.0-or-later](LICENSE). You may use, study, modify, and redistribute
it under that license. The software is provided without warranty.

Source repository:
<https://github.com/coolcoldplay/Brevess>

## Corresponding source

Every published extension archive must have a source tag or release with the
same version. Corresponding source includes the extension source, tests,
dependency lockfile, and the scripts needed to build and verify the release.
Generated browser profiles, local test output, historical archives, API keys,
user documents, and other credentials are not source and must not be committed.

## Build and verify

For the public unpacked preview, use Node.js 20+:

```sh
node --test tests/public-release.test.js tests/chrome-store-package.test.js tests/release-inventory.test.js
node scripts/build-public-test-release.mjs --name Brevess-Public-candidate
```

This browser-only ZIP retains the existing public manifest key so that unpacked
updates keep the same extension identity. It includes no credentials or local
data. Its source commit, per-file hashes and ZIP checksum are recorded beside it.

For the browser-only Chrome Web Store package, use Node.js 20+:

```sh
node --test tests/chrome-store-package.test.js tests/release-inventory.test.js
node scripts/build-chrome-store-release.mjs --name Brevess-Chrome-candidate
node scripts/verify-chrome-store-release.mjs dist/Brevess-Chrome-candidate
```

This build uses only Node built-ins, excludes the standalone MCP server and
native binaries, and records the source revision and per-file SHA-256 hashes.
The focused tests validate packaging; run the complete suite and browser
acceptance separately before publishing. See `docs/chrome-store/README.md`.

The older Windows/full-companion build uses the workflow below.

Requirements: Node.js 18 or later, PowerShell, Git, and Chrome or Edge for
browser verification. Building PDFFigures2 from source also requires a Java 8
JDK; the release script separately downloads and verifies the pinned Temurin
JRE used at runtime.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build:pdf-engine
npm.cmd run prepare:pdf-runtime
npm.cmd run build:unpacked -- -BuildName brevess-v1.0.1
```

The unpacked extension and optional local companion are generated under
`dist/`. Load only the extension directory from the browser extension
management page. The local companion is installed separately through its
signed installer or packaged installation script.

## Release checklist

1. Run the complete test suite.
2. Build an unpacked extension and confirm that `LICENSE`,
   `THIRD_PARTY_NOTICES.md`, `OPEN_SOURCE.md`, `README.md`, and `INSTALL.md`
   are present.
3. Tag the exact commit used for the binary archive.
4. Publish the binary and corresponding source from the same release page at
   no additional charge.
5. Update third-party provenance before incorporating external source code.

