# Local TIFF decoder dependencies

This directory contains unmodified, pinned official npm distribution bytes:

- **UTIF 3.1.0**, Ivan Kutskir: `UTIF-3.1.0.js`, MIT. See `UTIF-LICENSE.txt`.
- **pako 1.0.11**, inflate-only build: `pako_inflate-1.0.11.min.js`, MIT and Zlib. See `pako-LICENSE.txt` and `pako-ZLIB-LICENSE.txt`. The latter preserves the original notices from the eight zlib source modules included by the inflate-only build.

Official package sources:

- https://registry.npmjs.org/utif/-/utif-3.1.0.tgz
- https://registry.npmjs.org/pako/-/pako-1.0.11.tgz

JavaScript payload: 80,953 bytes (58,271 + 22,682). Both files are byte-for-byte official distributions. The extension loads them only from a local dedicated worker; it does not use a CDN or install npm dependencies at runtime. The adapter in `core/tiff-decoder.js` is BREVESS code and deliberately admits a smaller tested TIFF subset than UTIF supports. PNG encoding uses the browser's native CompressionStream, without another third-party library.

The fixed version, source file hashes, package hashes and application mapping are recorded in the accompanying TIFF candidate manifest. The existing release inventory recursively includes `vendor/` and `core/`; no added browser permission or remote-code exception is required. These notices must accompany the files when integrated and packaged.
