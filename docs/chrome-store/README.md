# Chrome 构建与商店材料

BREVESS 免费开源，AI 功能使用用户自己的模型和 API Key。商店上架材料位于本目录，准备材料不代表已获得商店审核批准。

## 使用 Node.js 20+ 构建

```sh
npm ci
npm run test:chrome-store
npm run build:chrome-store -- --name Brevess-Chrome-v1.0.2
npm run verify:chrome-store -- dist/Brevess-Chrome-v1.0.2
```

构建拒绝覆盖已有目录。产物位于 `dist/<名称>/`：浏览器 ZIP、同版源码 ZIP、`extension/` 解压目录、逐文件 SHA-256 清单和静态扫描结果。源码快照排除个人配置、浏览器状态、生成输出与可选本机二进制。

商店包移除开发 key 和 update_url，声明 Chrome 116 起的基础 API；开发源码保留稳定扩展 ID。浏览器内置翻译等可选能力取决于浏览器版本。Native Messaging 伴侣与 MCP 服务端需单独安装，商店分配扩展 ID 后应检查伴侣允许列表。

## 提交材料

- [中英文介绍](STORE_LISTING.md)
- [隐私与权限说明](PRIVACY_AND_PERMISSIONS.md)
- [审核操作说明](REVIEWER_INSTRUCTIONS.md)
- [素材规格](assets/README.md)
- [隐私政策](../privacy-policy.md)
- [发布检查范围](RELEASE_READINESS.md)

正式提交前应固定源码、完成回归与原生侧栏验收、重新生成真实截图、发布同版源代码，并在开发者后台确认权限与隐私信息。不得把密钥、个人研究资料或本机配置放进公开材料。

官方参考：[准备扩展](https://developer.chrome.com/docs/webstore/prepare) · [发布流程](https://developer.chrome.com/docs/webstore/publish) · [图片规范](https://developer.chrome.com/docs/webstore/images) · [隐私表单](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
