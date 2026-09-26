# PDFFigures2 engine

Brevess uses the pinned upstream PDFFigures2 command-line engine only for
PDF workspaces. MinerU remains responsible for text structure; PDFFigures2
provides whole Figure images, Figure identifiers, captions, pages, and PDF
boundaries. Web-publisher Figure extraction does not use this engine.

The generated `pdffigures2.jar` is intentionally excluded from source control.
Build and verify it with `scripts/build-pdffigures2.ps1`. Release packages must
include this directory's `VERSION.json` and `LICENSE.txt` alongside the JAR.
