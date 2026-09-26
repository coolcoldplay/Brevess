# Private source snapshot — 2026-09-27

This branch starts with a new root commit. It preserves the application source
from the local reliability work in a separate engineering snapshot. It does not
include earlier commit ancestry and does not replace any existing branch.

## Scope

- Browser application entry points, core modules, providers, localization,
  application icons, and vendored runtime resources.
- Native companion source and build metadata. Generated executables, JARs,
  downloaded runtimes, extension archives, and release packages are excluded.
- General project documentation and tests whose included inputs are synthetic.

Personal contact addresses in five source/documentation files were replaced
with `maintainer@example.invalid`. This reserved placeholder is not a working
support address. Apart from these contact substitutions, exported application
source bytes were copied unchanged. No product issue was fixed by this export.

## Local material intentionally omitted

User settings, credentials, browser profiles, local libraries, papers,
screenshots, conversations, coordination records, raw model requests/responses,
and local acceptance evidence are not part of this snapshot. Tests and scripts
with unresolved provenance or dependencies on omitted private material are also
excluded. Public third-party notices and software runtime assets are retained.

The remaining test files keep their existing logic. Their results must not be
interpreted as the complete regression suite or as validation of omitted live
model/browser workflows. Some package scripts refer to local-only tooling or
datasets and are unavailable in this snapshot.

This is source synchronization, not a release or an installation package.
Building or installing requires separate preparation of optional dependencies
and independent validation. No releases are created by this branch.
