(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  Object.assign(root.SciLLM ||= {}, api);
})(globalThis, function () {
  'use strict';
  const CLIENTS = Object.freeze([
    { id: 'codex', label: 'Codex', modelAdapter: 'codex-local', docs: 'https://developers.openai.com/codex/mcp' },
    { id: 'dsh', label: 'DeepSeek Harness（DSH）', modelAdapter: 'deepseek-harness', docs: 'https://deepseek-harness.github.io/deepseek-harness/reference/config-catalog' },
    { id: 'antigravity', label: 'Google Antigravity', transport: 'acp', docs: 'https://antigravity.google/docs/mcp' },
    { id: 'qwen', transport: 'acp', label: 'Qwen Code · 通义', region: 'cn', docs: 'https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/' },
    { id: 'kimi', transport: 'acp', label: 'Kimi Code · 月之暗面', region: 'cn', docs: 'https://moonshotai.github.io/kimi-code/en/customization/mcp.html' },
    { id: 'qoder', label: 'Qoder · 阿里', region: 'cn', docs: 'https://docs.qoder.com/cli/mcp-reference' },
    { id: 'workbuddy', transport: 'sdk', label: 'WorkBuddy · 腾讯', region: 'cn', docs: 'https://open.workbuddy.cn/docs/connector' },
    { id: 'codebuddy', transport: 'sdk', label: 'CodeBuddy Code · 腾讯', region: 'cn', docs: 'https://www.codebuddy.ai/docs/cli/mcp' },
    { id: 'trae', label: 'TRAE · 字节跳动', region: 'cn', configuration: 'client-ui', docs: 'https://docs.trae.ai/ide/model-context-protocol' },
    { id: 'claude', transport: 'sdk', label: 'Claude Code', docs: 'https://code.claude.com/docs/en/mcp' },
    { id: 'gemini', transport: 'acp', label: 'Gemini CLI', docs: 'https://geminicli.com/docs/tools/mcp-server/' },
    { id: 'cursor', transport: 'acp', label: 'Cursor', docs: 'https://cursor.com/docs/mcp' },
    { id: 'copilot', transport: 'acp', label: 'GitHub Copilot CLI', docs: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers' },
    { id: 'opencode', transport: 'acp', label: 'OpenCode', docs: 'https://opencode.ai/docs/mcp-servers/' },
    { id: 'generic', label: '其他 MCP 客户端', docs: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers' }
  ].map(Object.freeze));
  function getAgentSetupClients() { return CLIENTS.map(x => ({ ...x })); }
  function buildAgentSetupPrompt(client, context = {}) {
    const definition = CLIENTS.find(x => x.id === client);
    if (!definition) throw new Error('Unsupported Agent client');
    const name = definition.label;
    const id = /^[a-p]{32}$/.test(context.extensionId || '') ? context.extensionId : '请从 Chrome 扩展管理页确认';
    const version = /^[a-zA-Z0-9 ._-]{1,100}$/.test(context.version || '') ? context.version : '请检查已安装版本';
    const os = ({ mac: 'macOS', win: 'Windows', linux: 'Linux' })[context.os] || '请自动检测';
    return `请实际帮我完成 BREVESS 与 ${name} 的接入，不要只给操作教程。

当前浏览器插件：BREVESS ${version}
扩展 ID：${id}
系统：${os}
项目官方来源：https://github.com/coolcoldplay/Brevess
客户端官方配置说明：${definition.docs}

目标
1. ${definition.modelAdapter ? `在 BREVESS 内选择本机 ${name}（${definition.modelAdapter}），使用官方账号完成文本、结构化输出和适用的图片任务。` : '完成 MCP 读取与操作后，在插件设置中连接并测试，再在问答或工作台 Agent 菜单选中该客户端。核对本机返回的模型和推理选项，通过合成问答测试直连或客户端接单。'}
2. 在 ${name} 内通过 BREVESS MCP 读取文献总库、已有阅读资料和当前课题，并在我授权后操作假说梳理、组图规划等实际开放的工具。
3. 从 BREVESS 问答接单后，确需我选择时用 brevess_ask_user 原样发送问题、单选或多选及选项说明。在原任务用 brevess_get_user_answer 读取我的回答后继续，跳过表示我未作选择。需要客户端安全授权时走它自己的审批流程。

配置步骤
- 先找到本机正在加载的 BREVESS 源码或匹配版本的官方源码包，核对 manifest.json 的版本和扩展 ID；复用已有安装，不另外复制开发项目或盲目拉取另一版本。
- 阅读 docs/AGENT_QUICK_CONNECT.md。用 Node.js 运行该版本 scripts/setup-agent-connection.mjs --client ${client} --extension-id ${id} 配置，先运行 --dry-run 检查计划，再执行。缺少此文件说明源码版本不匹配，请明确说明，不自行猜安装器路径。若安装器返回 client-setup-required，请继续使用生成的配置文件和该客户端官方 CLI / MCP 设置界面完成接入；不能把生成文件当成已经接通。
- 自动检测已安装的官方客户端和 Node.js。需要依赖时使用官方渠道；无需我打开终端、找端口或手动安装桥接软件。保留其他 MCP 服务、模型配置、研究数据和已有登录；先备份再增量修改。不要覆盖整个配置文件。沿用现有权限。首次配置默认只读，需要课题写入时单独向我确认。
- Codex 通过 BREVESS 的“登录 / 重新登录”打开官方授权页，使用插件独立会话；DSH 使用官方客户端支持的账号登录。密码、验证码和账号授权由我在官方界面完成。不要从 auth.json、Cookie 或密码库提取、复制令牌，也不要把任何密钥或配对令牌放进提示词、聊天、截图或报告。
- 重载对应客户端及 BREVESS；在 BREVESS“模型与连接 → 连接你的 Agent”中点击“连接并测试”。不要只因端口可访问、发现工具或保存了登录就报告成功。

逐项验收
- BREVESS → ${name}：${definition.modelAdapter ? '实际完成一个合成文本问答、一个 JSON 结果；从官方目录确认图片能力后再测试微型图片。' : '从插件设置测试本机客户端公开的模型接口或桌面接单做一个合成问答，分别记录模型列表、实际回复及需要的登录。如果当前客户端版本没有可用的模型调用入口，标注「该版本待适配」。'}保留原来的默认模型与功能路由，除非我要求修改。
- ${name} → BREVESS：重新发现 MCP 工具，调用 brevess.status、brevess.capabilities 和 library.query_global_library，确认读到浏览器里实际打开的模块及数据。只使用实际存在的工具，不臆造高亮、翻译、解图控制接口。
- 写操作：新建明确标记的验收课题，先申请该课题的短期写权限，再创建一个假说节点或组图 Panel，回读并核对界面、保存和撤销；不拿我的真实课题做测试。
- 分别报告组件配置、官方账号、模型生成、MCP 读取、写入回读的真实结果；未测、需登录、客户端版本不兼容分别列明，不能笼统写“全部连接成功”。提供备份及恢复命令。`;
  }

  async function copyAgentSetupPrompt(client, { document: doc = globalThis.document, runtime = globalThis.chrome?.runtime } = {}) {
    const manifest = runtime?.getManifest?.() || {};
    let platform = {};
    try { platform = await runtime?.getPlatformInfo?.() || {}; } catch {}
    const prompt = buildAgentSetupPrompt(client, { extensionId: runtime?.id,
      version: manifest.version_name || manifest.version, os: platform.os });
    try { await doc.defaultView.navigator.clipboard.writeText(prompt); return { copied: true }; }
    catch {
      const dialog = doc.createElement('dialog'); dialog.className = 'focus-dialog';
      dialog.setAttribute('aria-label', '接入提示词');
      const heading = doc.createElement('h2'); heading.textContent = '复制接入提示词';
      const text = doc.createElement('textarea'); text.readOnly = true; text.value = prompt;
      text.setAttribute('aria-label', '接入提示词'); text.style.cssText = 'width:100%;min-height:260px;box-sizing:border-box;';
      const close = doc.createElement('button'); close.type = 'button'; close.textContent = '关闭'; close.onclick = () => dialog.close();
      dialog.append(heading, text, close); dialog.addEventListener('close', () => dialog.remove(), { once: true });
      doc.body.append(dialog); dialog.showModal(); text.focus(); text.select();
      return { copied: false };
    }
  }
  return { buildAgentSetupPrompt, copyAgentSetupPrompt, getAgentSetupClients };
});
