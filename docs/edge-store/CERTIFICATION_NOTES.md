# Notes for certification / 审核备注

The extension can be fully tested without a paid account or shared test credentials. Its local navigation, abbreviation extraction, manual annotation, and offline rule highlighting do not require an LLM. Optional LLM features use a provider configured by the reviewer; Brevess does not operate a shared cloud model account.

## Recommended test page

`https://coolcoldplay.github.io/Brevess/reviewer-demo.html`

This is an original, synthetic, copyright-free scientific article fixture created for certification. It contains Highlights, Summary, Results subsections, a synthetic Figure and Panel caption, Methods, Data availability, and References.

## Basic test steps (no credentials)

1. Install the extension and open the reviewer demo URL.
2. Click the Brevess toolbar icon.
3. On first use, select **暂时跳过 / Skip for now** for the optional local folder and optional API configuration, then finish onboarding.
4. The Edge side panel opens. In **导航 / Navigation**, confirm that the article outline appears and that a heading or paragraph jumps to the source.
5. Click the square **A** button in the shared toolbar. Confirm that the abbreviation table is alphabetically sorted and that a row jumps to its first source occurrence.
6. Open **亮文 / Highlights**, keep **正则 / Rules** selected, and run highlighting. Confirm that rule matches appear as colored underlines.
7. Select article text. Confirm that the manual annotation toolbar appears, supports reading-mode/category selection, optional notes, allowlist, and blocklist actions.
8. Open **摘句 / Evidence** and confirm that the section-by-category distribution links back to the highlighted source.

## Optional LLM test

1. Open Settings > **模型与分析**.
2. Create a compatible Provider profile, enter a model and endpoint, enter the reviewer’s own API credential, and enable the explicit article-transmission consent.
3. Save and use **测试连接**.
4. Return to the demo page and test **文段高亮**, **段落概述**, **逐图解读**, **跨图串解**, or **全文问答**.
5. In **本地数据**, inspect Token usage by article, feature, provider, and model.

The API key is stored only in local extension storage and is excluded from exports, diagnostics, caches, and logs.

## Optional local Codex Bridge

The Windows Codex Bridge is optional external companion software. Microsoft Edge does not install or manage it. Local navigation, regular-expression highlighting, and manual annotations do not depend on it.

If certification needs this route, download the separately published companion package:

`https://github.com/coolcoldplay/Brevess/releases/latest/download/Brevess-Codex-Bridge-Windows-x64.zip`

After the Edge Add-ons item has an assigned extension ID, that ID must be listed in the companion package’s `catalog-extension-ids.txt` before testing Native Messaging.

## Expected network behavior

- No remote JavaScript or WebAssembly is loaded.
- HTTPS requests go only to resources needed by the active paper or to the provider configured by the user.
- Plain HTTP is restricted to `localhost` and `127.0.0.1` for user-run local providers.
- There are no ads, analytics SDKs, background browsing-history scans, or data-broker integrations.

## Platform

The extension is designed for desktop Microsoft Edge with Manifest V3 and the Edge Side Panel API. The optional Codex Bridge companion is Windows-only; all other local features remain available without it.
