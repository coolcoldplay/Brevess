# Open-source release policy

## License

SCI论文逻辑助手 is free software licensed under
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

Requirements: Node.js 18 or later, PowerShell, and Chrome or Edge for browser
verification.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build:unpacked -- -BuildName brevess-v1.0.0
```

The unpacked extension is generated under `dist/`. Load that directory from
the browser extension management page in developer mode.

## Release checklist

1. Run the complete test suite.
2. Build an unpacked extension and confirm that `LICENSE`,
   `THIRD_PARTY_NOTICES.md`, `OPEN_SOURCE.md`, `README.md`, and `INSTALL.md`
   are present.
3. Tag the exact commit used for the binary archive.
4. Publish the binary and corresponding source from the same release page at
   no additional charge.
5. Update third-party provenance before incorporating external source code.

