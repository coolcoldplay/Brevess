# BREVESS local PDF.js patch

2026-10-22: `build/pdf.worker.min.mjs`, `getUnicodeForGlyph` strips a glyph
name's period suffix before the existing scalar-name decoder. This follows
step 1 of the [Adobe Glyph List specification](https://github.com/adobe-type-tools/agl-specification#2-the-mapping).
An embedded CFF glyph such as `uni2212.texminus` declares U+2212; the upstream
decoder otherwise rejects its length and can emit a NUL character.

`adjustType1ToUnicode` also uses the embedded Type1/CFF encoding to fill
entries missing from a partial explicit ToUnicode map. Existing explicit
entries are checked with `has` and never replaced. The original checks for
internal fonts, identity maps and explicitly supplied PDF encodings remain.

This does not infer a character from the article, font name, or control byte.
Unknown glyph names remain unresolved. Caption/source completeness checks,
explicit PDF Unicode mappings, rendering, and original PDF bytes are unchanged.
No library version or dependency was changed; the original Apache-2.0 license
remains in LICENSE and the worker header.

Regression: `tests/r13-pdf-glyph-suffix.test.cjs`. When updating the vendor,
verify whether upstream implements glyph suffixes and rerun this regression
plus native PDF extraction before retaining or removing this patch.
