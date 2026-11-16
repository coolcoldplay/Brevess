# Brevess Local Companion for Windows

This optional companion enables two local-only capabilities in the Brevess
Microsoft Edge extension:

- whole-Figure and caption extraction from PDF files using PDFFigures2, with
  a local PDFBox recovery pass for cross-page legends and missed whole-page Figures;
- a loopback-only, translation-compatible reading page for parsed PDFs;
- the **Local Codex** model provider.

It bundles its own Java runtime. Users do not need to install Java. The
extension's navigation, abbreviation extraction, highlighting, manual
annotations, local workspaces, MinerU text parsing, and bring-your-own-API
providers continue to work without this companion.

## Install

1. Extract this ZIP completely.
2. Double-click `Install-Brevess-Codex-Bridge.cmd`, or run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

3. Restart Microsoft Edge.
4. PDF whole-Figure extraction is now available. If you also want Local Codex,
   install Codex, create a **Local Codex** profile in Brevess, and sign in to
   the extension-specific Codex session.

The allowed Microsoft Edge extension IDs are stored in
`catalog-extension-ids.txt`. If Microsoft assigned a different catalog ID, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId YOUR_32_CHARACTER_ID
```

Multiple IDs can be passed as a comma-separated value.

## Uninstall

Double-click `Uninstall-Brevess-Codex-Bridge.cmd`, or run `uninstall.ps1`.
The script removes Native Messaging registration. It intentionally keeps the
recoverable session mapping under `%LOCALAPPDATA%\BrevessCodexBridge`; remove
that folder manually only if you also want to erase the local bridge data.

## Security boundary

- The bridge communicates only with extension origins listed in its Native
  Messaging manifest.
- Brevess does not read the desktop Codex or Codex CLI token store.
- Uploaded PDF bytes and temporary Figure images stay on the local computer
  and are deleted after import completes, fails, is cancelled, or its lease
  expires.
- The optional translation page is served only from a random, unguessable URL
  on `127.0.0.1`, is not cached, accepts no remote writes, and expires after six
  hours. This ordinary local webpage lets translation extensions operate even
  though browsers prohibit them from injecting into another extension's page.
- PDFFigures2 and the bundled Java runtime run locally and do not require a
  Local Codex login.
- The bridge does not enable shell, filesystem mutation, MCP, or web-search
  tools for paper-analysis turns.

## Included open-source components

- PDFFigures2 0.1.0, pinned commit
  `3d7ad46753d4a315cccd1c2bcab398380e88c534`, Apache-2.0.
- Eclipse Temurin JRE 8u492-b09, GPL-2.0 with the Classpath Exception.

Their license and notice files are included beside the corresponding files.

Source code and full setup notes:
https://github.com/coolcoldplay/Brevess
