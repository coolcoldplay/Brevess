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

## Sidebar icons: selected SemanticIcons 02 / R4.3

The current five sidebar icons use original Lucide-static 1.55.0 and Material
Design Icons geometry with CSS animation. The resource catalog also retains
Tabler 3.49.0 comparison assets. Components, original
SVGs, licenses, fixed versions and SHA256 provenance are retained under
`vendor/semantic-icons-r42/`. `sidebar-module-icons.js` adapts the component
to the existing production task state; it does not use a morphing engine.

- Lucide: ISC, including the Feather-derived MIT notice;
  [license](vendor/semantic-icons-r42/vendor/lucide/LICENSE).
- Tabler, Copyright (c) 2020-2026 Paweł Kuna: MIT;
  [license](vendor/semantic-icons-r42/vendor/tabler/LICENSE).
- Material Design Icons, Pictogrammers: Pictogrammers Free License with
  Apache-2.0 for icons;
  [notice](vendor/semantic-icons-r42/vendor/mdi/LICENSE),
  [Apache-2.0 text](vendor/semantic-icons-r42/vendor/mdi/LICENSE-Apache-2.0.txt).
- The unmodified resource catalog retains unused comparison assets from
  Phosphor and Microsoft Fluent. Their licenses and provenance are retained
  in the corresponding `vendor/semantic-icons-r42/vendor/` directories.

## Retained Lucide Icons and Morphicons resources

The earlier sidebar implementation used Lucide-static 1.55.0 SVG geometry and
the Morphicons 1.7.1 path interpolation engine. Those original resources and
license records remain in the repository; the current sidebar does not load
that engine.
The mono-resource-r3 asset set includes the original selection-frame, scan-eye,
and message-circle pairs under `vendor/lucide/`; their hashes are recorded in
`vendor/lucide/PROVENANCE.json`. Bundled license copies are also retained under
`licenses/lucide-ISC-MIT.txt` and `licenses/morphicons-MIT.txt`.

- Lucide Icons and Contributors: ISC, with the included Feather-derived MIT notice.
  Upstream: <https://github.com/lucide-icons/lucide>.
  Full license: [vendor/lucide/LICENSE](vendor/lucide/LICENSE).
- Morphicons, Copyright (c) 2026 Guillermo: MIT.
  Upstream: <https://github.com/guillermolg00/morphicons>.
  Full license: [vendor/morphicons/LICENSE](vendor/morphicons/LICENSE).
- Fixed package versions, official package URLs, integrity values and SVG hashes
  are recorded in each library's `vendor/*/PROVENANCE.json`.

## PDF.js

The PDF reader includes PDF.js 5.4.624 under `vendor/pdfjs/`. The selection
controller in `core/pdf-text-projection.js` adapts the same version's
`web/text_layer_builder.js` selection boundary handling.

- Copyright Mozilla Foundation and contributors
- License: Apache License 2.0
- Upstream: <https://github.com/mozilla/pdf.js/tree/v5.4.624>
- License copy: [vendor/pdfjs/LICENSE](vendor/pdfjs/LICENSE)

## Development-only dependencies

Playwright is used only for automated browser verification and is not copied
into the extension package. Its license is recorded by the npm dependency
metadata and lockfile.

## PDFFigures2 (optional local companion)

The optional Windows local companion uses PDFFigures2 to extract complete
Figure regions, identifiers, and captions from PDF files. It is not included
in the Microsoft Edge extension ZIP.

- Copyright (c) 2016 Allen Institute for Artificial Intelligence
- Upstream version: `0.1.0`
- Pinned commit: `3d7ad46753d4a315cccd1c2bcab398380e88c534`
- License: Apache License 2.0
- Upstream: <https://github.com/allenai/pdffigures2>
- License copy: `native-host/pdffigures2/LICENSE.txt`

## Eclipse Temurin JRE (optional local companion)

The optional Windows local companion includes Eclipse Temurin JRE 8u492-b09
so users do not need to install Java. It is not included in the Microsoft Edge
extension ZIP.

- OpenJDK version: `1.8.0_492-b09`
- Platform: Windows x64, HotSpot JRE
- License: GPL-2.0 with the Classpath Exception
- Upstream release: <https://github.com/adoptium/temurin8-binaries/releases/tag/jdk8u492-b09>
- The `LICENSE`, `ASSEMBLY_EXCEPTION`, `NOTICE`, and `THIRD_PARTY_README`
  files are retained at the root of the packaged `runtime/` directory.

## JAI Image I/O (optional local companion)

The optional Windows local companion includes JAI Image I/O Core and its
JPEG2000 plugin so PDFBox/PDFFigures2 can decode JPX images embedded by some
publishers. These files are not included in the Microsoft Edge extension ZIP.

- Components: `jai-imageio-core` 1.4.0 and `jai-imageio-jpeg2000` 1.4.0
- Upstream: <https://github.com/jai-imageio/jai-imageio-core>
- Binary source: Maven Central (`com.github.jai-imageio`)
- License: BSD-style licenses retained from each binary JAR
- License and notice copies:
  - `native-host/pdffigures2/LICENSE-jai-imageio-core.txt`
  - `native-host/pdffigures2/NOTICE-jai-imageio-core.txt`
  - `native-host/pdffigures2/LICENSE-jai-imageio-jpeg2000.txt`
  - `native-host/pdffigures2/NOTICE-jai-imageio-jpeg2000.txt`

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

