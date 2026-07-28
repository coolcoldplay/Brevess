# Brevess Codex Bridge for Windows

This optional companion enables the **Local Codex** provider in the Brevess
Microsoft Edge extension. The extension's navigation, abbreviation extraction,
regular-expression highlighting, manual annotations, local workspaces, and
bring-your-own-API providers work without this companion.

## Install

1. Install Codex and confirm that `codex --version` works in PowerShell.
2. Extract this ZIP completely.
3. Double-click `Install-Brevess-Codex-Bridge.cmd`, or run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

4. Restart Microsoft Edge.
5. Open Brevess settings, create a **Local Codex** profile, and sign in to the
   extension-specific Codex session.

The allowed Microsoft Edge extension IDs are stored in
`catalog-extension-ids.txt`. If Microsoft assigned a different catalog ID, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId YOUR_32_CHARACTER_ID
```

Multiple IDs can be passed as a comma-separated value.

## Uninstall

Double-click `Uninstall-Brevess-Codex-Bridge.cmd`, or run `uninstall.ps1`.
The script removes Native Messaging registration. It intentionally keeps the
recoverable session mapping under `%LOCALAPPDATA%\SCIReaderCodexBridge`; remove
that folder manually only if you also want to erase the local bridge data.

## Security boundary

- The bridge communicates only with extension origins listed in its Native
  Messaging manifest.
- Brevess does not read the desktop Codex or Codex CLI token store.
- Temporary Figure images are deleted after the turn completes, fails, or is
  cancelled.
- The bridge does not enable shell, filesystem mutation, MCP, or web-search
  tools for paper-analysis turns.

Source code and full setup notes:
https://github.com/coolcoldplay/Brevess
