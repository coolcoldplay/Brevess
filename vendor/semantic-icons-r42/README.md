# Sidebar icons — selected 02 / R4.3

`resources.js`, `icons.js`, and `icons.css` are byte-identical to the selected
R4.3 handoff. `SELECTED-02.json` retains the handoff SHA256 values.
The directory retains its initial integration name for a stable loader path;
the selected manifest identifies the current revision. R4.3 restores the single
chat bubble and keeps the other four SVGs unchanged from R4.2.

The production adapter is `../../sidebar-module-icons.js`; it fixes scheme 2,
keeps tab selection separate from task state, and accepts only real task
progress from the existing sidebar controller. The adapter CSS supplies the
gold task progress bar and keyboard focus. No preview task simulator is loaded.

Original SVGs, family LICENSE files and pinned-source PROVENANCE records are
retained under `vendor/`. The unmodified resource catalog also contains unused
comparison assets, so their original licenses are included as well. Package
archives, preview pages and test evidence are not distributed here.

Selected resources: Lucide list-tree, expand (four corner nodes),
chart-no-axes-column, message-square-more and notebook-text; MDI marker.
Unused comparison sources are retained with attribution. Licenses are in the respective
family directories. The composition and motion do not change original SVG
node attributes; CSS and group transforms implement the reviewed appearance.
