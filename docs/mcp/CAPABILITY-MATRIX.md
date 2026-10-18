# BREVESS MCP capability matrix

Status date: 2026-10-18

This matrix maps human-facing operation families to the existing domain code,
the MCP tool, the access class, and the verification actually performed. It is
not a claim that every operation has a real Workbench host implementation yet.

Legend:

- **A**: MCP adapter exists; tested at the protocol/bridge boundary. Real
  Workbench host execution still needs the final E2E.
- **S**: MCP schema exists from the active Workbench operation contract, but the
  Workbench host operation is not yet connected.
- **G**: No MCP adapter yet. This is an explicit gap, not a hidden success.
- **H**: Human/OS-only interaction. MCP must return `PENDING_HUMAN_ACTION` and
  cannot fill the approval, secret, picker or browser profile.
- **R**: Read-only.

Protocol tests: `tests/mcp-server.test.cjs`, 15/15 passing including stdio,
localhost HTTP, tools/list, tools/call, resources/read, idempotency, write
scope and bridge error mapping; `tests/mcp-runtime-workbench-query.test.js`
1/1 for the MCP query-form sender boundary. A real headless Edge bridge smoke also passed
(`output/mcp-20261018/workbench-bridge-smoke.json`): bridge online, 45 tools,
15 Workbench operations, bootstrap project creation, hypothesis/Figure/Panel
planning, evidence-block creation, edge relation, legacy readback and a real
45-page PDF open. The remaining R35 gaps are recorded below.

## 1. Workbench shell and projects

| Human UI operation | Existing path | MCP tool | Access | Status / test |
| --- | --- | --- | --- | --- |
| 新建课题 | `app.js` new-project → `M.project` → `session.create` | `workbench.create_project` | bootstrap approval + CAS | A (real isolated bootstrap smoke: project revision 1) |
| 导入完整课题 | import input → `importResearchWorkbenchBundle` | `workbench.import_project` | task scope; no overwrite | A, host pending |
| 完整导出 | `exportResearchWorkbenchBundle` | `workbench.export_project` | read | A, host pending |
| 列出/读取课题 | `session.store.listProjects/getProject` | `workbench.list_projects`, `workbench.get_project` | read | A, protocol test |
| 打开/切换课题 | `session.open`, `select` | `workbench.navigate` | CAS view write | A |
| 课题重命名/问题/字段编辑 | UI property edit → `session.edit` | `workbench.edit_project` | CAS | A |
| 删除课题 | `session.remove('project')` | `workbench.remove_entity` | human confirm | A schema; per-call approval still required |
| 恢复课题 | recycle → `session.restore` | `workbench.restore` | human confirm | A schema |
| 回收站读取 | `store.listRecycle` | `workbench.list_recycle` | read | A |
| 撤销/重做 | `session.undo/redo` | `workbench.undo`, `workbench.redo` | task scope + CAS | A |
| 演示课题 | `demo.json` import | `workbench.import_project` with demo bundle | task scope | A path, no UI trigger |
| 保存/重开一致性 | store + view + asset hydration | `workbench.read_context` after each write | read | A, real host pending |

## 2. Hypothesis map

| Human UI operation | Existing path | MCP tool | Access | Status / test |
| --- | --- | --- | --- | --- |
| 新建假说 | `new-hypothesis` → `M.hypothesis` | `workbench.model_operation` `create_hypothesis`; high-level `workbench.plan_hypotheses` | task scope | A (real smoke: 3 nodes, 2 edges) |
| 编辑假说名称 | property editor | `workbench.edit_project` | CAS | A |
| 新建节点 | canvas add object | `workbench.model_operation` `create_node`; `workbench.plan_hypotheses` | task scope | A |
| 编辑节点标签/位置/类型 | property editor / drag | `workbench.edit_project`, `model_operation` | CAS | A |
| 新建联系 | port drag → edge push | `model_operation` `create_edge`; `plan_hypotheses` | task scope | A |
| 编辑 claim/条件/端口/路线 | property editor | `workbench.edit_project`, `model_operation` | CAS | A, legacy schema |
| 设置联系分支/反馈 | new `edge.kind` contract | `workbench.set_edge_relation` | routine_write scope | S; host pending |
| 素材拼图（支持/反对/中性） | new `materialLinks` contract | `workbench.attach_material` | routine_write scope | S; host pending |
| 修改素材立场/备注 | new `materialLinks` contract | `workbench.update_material_stance` | routine_write scope | S; host pending |
| 绑定论文/Figure/Panel/证据 | workbench reference/binding drag | `workbench.model_operation` `bind_resource`; `library.import_and_bind` | task scope | A |
| 人工字段/未知字段/待复核 | UI property/status/link `needsReview` | `workbench.edit_project` preserving unspecified fields | CAS | A |
| 删除节点/联系 | selection delete | `model_operation` `delete_objects` | human confirm if destructive | A schema; host approval required |
| 删除假说 | manage dialog | `workbench.remove_entity` | human confirm | A schema |
| 恢复假说 | recycle dialog | `workbench.restore` | human confirm | A schema |

## 3. Figure/Panel planning

| Human UI operation | Existing path | MCP tool | Access | Status / test |
| --- | --- | --- | --- | --- |
| 新建方案 | `new-plan` → `M.plan` | `model_operation` `create_plan`; `workbench.plan_figures` | task scope | A (real smoke: plan/figure/2 panels) |
| 新建 Figure | `new-figure` → `M.figure` | `model_operation` `create_figure`; `plan_figures` | task scope | A |
| 新建 Panel/文本/箭头/标注 | tool rail | `model_operation` `create_panel`; `plan_figures` | task scope | A |
| 编辑 Panel 目的/实验/读出/结果 | inspector | `workbench.edit_project`, `model_operation` | CAS | A |
| Panel 状态 planned/running/complete/review | `updatePanelStatus` | `model_operation` `set_panel_status` | CAS | A |
| 分组表格 | `createGroupTable`/`editGroupTable` | `model_operation` `edit_group_table` | CAS | A |
| 布局预览/应用 | `M.layout` | `model_operation` `layout`, `arrange` | CAS | A |
| 对齐/分布 | `M.arrange` | `model_operation` `arrange` | CAS | A |
| 复制/移动 Panel | `duplicate`, `move_panels` | `model_operation` | CAS | A |
| 组合/解组 | `group`, `ungroup` | `model_operation` | CAS | A |
| 复制方案/分支/版本 | `M.branch`, history | `model_operation` `branch_plan`, `save_plan_version` | CAS | A |
| Figure 顺序/故事顺序 | drag order / story mode | `model_operation` `reorder_figures`; `save_view` | CAS | A |
| 参考/资源绑定 | `Panel.references`, `captureResource` | `model_operation` `capture_resource`, `bind_resource` | CAS | A |
| 证据块创建 | new `figure.evidenceBlocks` contract | `workbench.create_evidence_block` | routine_write scope | A (real smoke: 1 evidence block) |
| Panel 图片导入 | `saveImages` / `session.edit({assets})` | `workbench.import_asset` | task scope | A |
| Panel 图片读取 | `getAsset` + SHA check | `workbench.read_asset` | read | A |
| 删除方案/Figure | manage dialog | `workbench.remove_entity` | human confirm | A schema |
| 恢复方案/Figure | recycle | `workbench.restore` | human confirm | A schema |

## 4. Common workbench operations

| Human UI operation | Existing path | MCP tool | Access | Status / test |
| --- | --- | --- | --- | --- |
| 导航/选择 | `session.select`, `navigate` | `workbench.navigate` | CAS view | A |
| 保存画布缩放/平移/选择 | `saveEntityView` | `workbench.save_view` | CAS view | A |
| 故事视图/画板 | `ui.story`, `invokeAction` | `workbench.save_view`, `workbench.invoke_action` | CAS view | A |
| 左右/属性/资源 pane | `savePanes` | `workbench.save_view` `panes` | CAS view | A |
| 剪贴板复制/粘贴 | `ui.clipboard` | `workbench.clipboard` | task scope | A |
| 自适应/缩放/网格 | canvas controls | `workbench.invoke_action` | CAS view | A |
| 来源定位 | `locateSource` / runtime bridge | `workbench.locate_source` | read with identity checks | A |
| 数据目录创建/打开 | native directory service | `workbench.data_directory` | human_os_picker | A protocol, OS approval in UI |
| 完整导入/导出兼容 | import/export bundle | `workbench.import_project`, `workbench.export_project` | task/read | A, real host pending |

## 5. Literature library and saved reading

| Human UI operation | Existing path | MCP tool | Access | Status / test |
| --- | --- | --- | --- | --- |
| 全局文库查询（本地+雷达已读） | `LOCAL_READING_LIBRARY_QUERY` + radar read merge | `library.query_global_library` | read | A (real bridge smoke, empty isolated library) |
| 本地文库查询 | `adapter.queryLibrary` | `library.query_library` | read | A |
| 读取论文/Figure/Panel/证据/段落 | `adapter.readWorkspace/projectResources` | `library.read_workspace` | read + source hash | A |
| 读取素材/图片 | `ARTICLE_WORKSPACE_GET_ASSET` | `library.local_data` `read_asset`, `workbench.read_asset` | read | A |
| 标签读写 | local library tags | `library.local_data` `set_tags` | task scope + CAS | A |
| 文献公开 JSON 修改 | `agent-local-data` patch | `library.local_data` `patch_asset` | task scope + per-call UI approval | A |
| 工作区导出 | `ARTICLE_WORKSPACE_EXPORT` | `library.local_data` `read_export` | read | A |
| 工作区永久删除 | local data delete route | `library.local_data` `delete_workspace` | human confirm + preview | A schema; UI approval mandatory |
| 段落笔记/标注/人工记录 | workspace assets and notes | `library.local_data` read/patch allowlist | read/approval | A; source/PDF routes remain read-only |
| 文献笔记/标签 UI | local library modules | same local_data/read tools | read/approval | A, no dedicated note editor tool yet |
| 论文/Figure/Panel 定位回原文 | runtime workbench bridge | `workbench.locate_source` | read with identity | A |

## 6. Workbench Operation Contract v1 (first adapters)

| Operation | MCP tool | Contract access | Status |
| --- | --- | --- | --- |
| `query_global_library` | `library.query_global_library` | read/none | A (real bridge smoke, empty isolated library) |
| `attach_material` | `workbench.attach_material` | routine_write | S; needs saved library resource E2E |
| `update_material_stance` | `workbench.update_material_stance` | routine_write | S; needs saved library resource E2E |
| `create_evidence_block` | `workbench.create_evidence_block` | routine_write | A (real smoke) |
| `set_edge_relation` | `workbench.set_edge_relation` | routine_write | A (real smoke: edge.kind=branch) |

All five write operations require `expectedProjectId`, `expectedRevision` and
an idempotency key. The four routine writes also require
`brevess.request_write_scope` with a human-approved task scope. The scope is
checked again by the Workbench host; MCP never writes directly.

## 7. Literature radar

| Human UI operation | Existing path | MCP tool | Access | Status / test |
| --- | --- | --- | --- | --- |
| 雷达任务列表 | radar store | `radar.list` | read | A |
| 读取版本/论文/摘要 | radar store + backfill | `radar.get`, `radar.backfill_abstracts` | read/task write | A |
| 保存/启停/频率/检索式 | radar store.save | `radar.save` | task scope + editVersion | A |
| 手动检查新增 | radar service.check | `radar.check` | task scope + 120s bounded network | A |
| 标记已读/未读 | radar store.markRead | `radar.mark_read` | task scope + CAS | A |
| 将已读雷达条目加入总库 | new `query_global_library` merge view | `library.query_global_library` | read | S; metadata-only must stay explicit |

## 7b. Portable library transfer

| Human UI operation | Existing path | MCP tool | Access | Status |
| --- | --- | --- | --- | --- |
| 导出雷达/总库 metadata | `core/literature-radar-transfer.js`, `workbench/global-library-transfer.js` | `library.export_transfer` | read | Schema/adapter added; Workbench host hook pending |
| 导入雷达/总库 metadata | same transfer services | `library.import_transfer` | human confirm + idempotency | Schema/adapter added; Workbench host hook pending |

`brevess-library-transfer-v1` exports no credentials, PDF bytes or full-text
storage. Radar merges/read status are atomic through the radar store; global
library metadata is merged by PMID > DOI > normalized title.

## 8. PDF/Figure and translation

| Human UI operation | Existing path | MCP tool | Access | Status / test |
| --- | --- | --- | --- | --- |
| 打开指定本地 PDF | `pdf-reader.html?source=file://...`, native reader | `pdf.open_local` | human-provided path + read | A (real bridge smoke: opened, readerUrl/tabId) |
| PDF 标题/DOI/页数/大纲/参考文献 | native PDF structure/index | `pdf.open_local` + future `pdf.status` | read | 45 pages and title/hash read; phase text-ready, outline/refs pending |
| 单图/批量解图 | popup figure workflow | none | - | G; needs `figure.extract` operation |
| Figure/Panel 追问/补齐 | figure workflow | none | - | G |
| 原图/页码回定位 | PDF reader / navigation identity | `workbench.locate_source` for project sources | read | A for bound sources; PDF native graph pending |
| Figure/Panel 人工命名 | figure naming UI | none | - | G |
| 图表/内容规划证据块 | new contract | `workbench.create_evidence_block` | routine_write | S |
| 标题/全文翻译触发与回执 | translation providers/messages | none | - | G; needs `translation.*` contract |
| 大纲翻译缓存/重开一致性 | translation checkpoint | none | - | G |

## 9. Settings and safety boundaries

| Human UI operation | Existing path | MCP tool | Access | Status |
| --- | --- | --- | --- | --- |
| 读取模型/路由/偏好状态 | settings storage | none | - | G; do not expose secrets |
| 修改可公开偏好 | options settings | none | - | G; needs settings contract |
| 修改模型路由/非秘密配置 | options settings | none | - | G; needs settings contract |
| 保存 API key/凭据 | secure local input | none | human_secret | H; MCP must return pending |
| 系统目录选择器 | native directory picker | none | human_os_picker | H |
| 永久删除/覆盖工作区 | local data delete/overwrite | `library.local_data` | human_confirm | A schema; UI approval mandatory |
| 浏览器 profile / cookie / 密码 | browser-managed | none | never | H; forbidden |
| 摘要/来源变化/人工编辑保护 | existing guards | propagated as errors/details | - | A protocol; host E2E pending |

## 10. Known integration gaps / requests

The following are not silently treated as covered:

1. The Workbench host object `window.BrevessWorkbenchMCP` must be published and
   must call the existing session/store path. The bridge script is present;
   the Workbench owner still owns the load point and host implementation.
2. `pdf.open_local` needs a real Workbench/PDF host operation returning parsed
   metadata. MCP must not parse the PDF itself.
3. `figure.extract`, `figure.complete`, `figure.rename`, `translation.*` and
   public `settings.*` operations need machine-readable contracts before MCP
   can claim full coverage.
4. Background/native-messaging relay exact message types and sender identity
   checks are specified in `mcp/extension/HOST-INTEGRATION.md`; `background.js`
   and `manifest.json` remain total-control-owned and were not modified.
5. Real E2E with the 45-page/97-reference PDF, Codex or DeepSeek harness,
   Workbench screenshots, save/reopen and undo/restore is not yet run.
6. MCP now sends the null-project one-shot bootstrap scope, but the Workbench
   host must add `requestBootstrapScope`/`request_bootstrap_scope`; the current
   `requestWriteScope` still rejects an empty projectId.

