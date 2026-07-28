# Third-party notices

Brevess is licensed under the GNU Affero General Public License,
version 3 or any later version. See [LICENSE](LICENSE).

## Phosphor Icons

The packaged extension includes the Phosphor icon font and its CSS under
`vendor/phosphor/`.

- Copyright (c) 2020-2021 Phosphor Icons
- License: MIT
- Upstream: <https://github.com/phosphor-icons/core>
- License copy: [vendor/phosphor/LICENSE](vendor/phosphor/LICENSE)

## Development-only dependencies

Playwright is used only for automated browser verification and is not copied
into the extension package. Its license is recorded by the npm dependency
metadata and lockfile.

## External-code provenance

The following deterministic modules include code adapted from
[`yilewang/llm-for-zotero`](https://github.com/yilewang/llm-for-zotero):

- Upstream release: `3.8.27`
- Pinned commit: `f8dbbd863b021368c07efe0f61c67f3503d79bc9`
- Package author metadata: Yile Wang
- Upstream license: GNU Affero General Public License, version 3 or any later
  version (`AGPL-3.0-or-later`)
- Original file-level notice: the source files listed below contain no
  separate copyright header; the upstream package metadata identifies Yile
  Wang as author and the repository-level `LICENSE` supplies the AGPL notice.
- License copy: this repository's [LICENSE](LICENSE) contains the same
  AGPL-3.0-or-later terms governing the adapted code and the combined work.

| Upstream source path | Local destination | Adaptation summary |
| --- | --- | --- |
| `src/modules/contextPanel/retrievalTokenizer.ts` and the stopword set in `src/modules/contextPanel/constants.ts` | `core/article-chat-tokenizer.js` | Removed TypeScript and Zotero module imports; wrapped as repository UMD; normalized Unicode dashes, quotes, soft hyphens, and whitespace; kept CJK/Kana/Hangul bigrams within adjacent script runs; added an optional query token cap; intentionally retained the scientific negation terms `no` and `not`. |
| `src/modules/contextPanel/quoteTextNormalization.ts` | `core/article-chat-citations.js` | Removed TypeScript types and host imports; wrapped as repository UMD; retained source-offset mapping, invalid-control handling, layout-hyphen repair, LaTeX style masking, and canonical matching; added string-or-index convenience input and `start`/`end` aliases. |
| `src/modules/contextPanel/blockStreamCoalescer.ts` | `core/article-chat-stream.js` | Removed TypeScript types; wrapped as repository UMD; replaced readable-character flushing with Markdown-aware complete-block scanning so unfinished paragraphs, lists, tables, and fenced code are not emitted; added explicit finalization. |
| `src/modules/contextPanel/queuedFollowUps.ts` | `core/article-chat-queue.js` | Removed Zotero conversation, DOM registration, and global storage state; converted the queue to an instance-scoped pure state machine; bound an immutable model profile to each entry; added pre-send deletion and active-request cancellation via `AbortController`. |

The adapted files were modified on 2026-07-20. They are provided without
warranty under the AGPL terms described in [LICENSE](LICENSE).

