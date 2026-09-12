# HTML Atelier

Preview static HTML files in a native sidebar, edit page text in place, and save changes while preserving source formatting. Requires desktop Obsidian 1.7.2 or later. Page scripts are never executed.

## Installation

1. Open **Settings → Community plugins** in Obsidian.
2. Search for **HTML Atelier**, then install and enable it.
3. Click an `.html` or `.htm` file in your vault. The right sidebar opens and selects the **HTML** panel automatically.

Manual installation (optional): if another HTML preview or editing plugin is enabled, disable it first so it does not take over `.html` / `.htm` files. Download `main.js`, `manifest.json` and `styles.css` from GitHub Releases, put them into `.obsidian/plugins/html-atelier/` (the final structure must be `.obsidian/plugins/html-atelier/main.js`, without an extra nested folder), then restart Obsidian and enable the plugin under **Settings → Community plugins**.

## Usage

- HTML files open in preview mode in the central area, with the **HTML** panel in the right sidebar.
- Use **Preview / Edit text** at the top of the panel to switch modes; **Undo / Save** sits below.
- In edit mode, click text on the page to select it, then edit it in the sidebar; the page updates live.
- **Save** (or Ctrl+S / Cmd+S inside the panel) writes all pending text changes back to the source file. Untouched tags, attributes, comments, styles, line breaks and entity spellings stay exactly as they were. You can also assign your own hotkey to the "Save current HTML" command.
- The editor's Ctrl+Z / Cmd+Z undoes the current editing history (up to 200 steps); redo is not available yet.
- **Restore** next to "Before save" reverts the selected text to its last saved state; restoring can be undone.
- Unsaved changes are kept as a local draft in plugin data and restored when the file is reopened. If the file changes outside Obsidian, the plugin refuses to overwrite it and offers **Save draft as** / **Reload original file** instead.
- Editing covers visible text nodes (headings, paragraphs, link and button labels, and similar). Images, link URLs, CSS, input values, text inside SVG, hidden areas and HTML structure are not edited.
- Desktop only; not adapted for phones or tablets.

---

在 Obsidian 中预览静态 HTML，并在原生右侧栏修改页面文案。适用于桌面版 Obsidian 1.7.2 及以上版本。

## 安装

1. 在 Obsidian 中打开「设置 → 第三方插件」，进入「社区插件市场」。
2. 搜索「HTML Atelier」，安装并启用。
3. 点击库内一个 `.html` 或 `.htm` 文件，右侧栏会自动展开并选中「HTML」面板。

手动安装（可选）：如果已启用其他 HTML 预览或编辑插件，先停用它们，避免抢占 `.html` / `.htm` 文件的打开方式。从 GitHub Releases 下载 `main.js`、`manifest.json`、`styles.css`，放入 `.obsidian/plugins/html-atelier/`（确认最终结构是 `.obsidian/plugins/html-atelier/main.js`，不要再套一层同名文件夹），重启 Obsidian 后在「设置 → 第三方插件」中启用。

## 操作

- 默认进入预览模式，中央区域完整显示 HTML 页面。
- 右侧栏顶部切换「预览 / 编辑文案」，下面提供「撤销 / 保存」。
- 在编辑模式下点击页面文字，右侧显示对应文案；输入时页面实时更新。
- 点击「保存」或按 Ctrl+S（macOS 为 Cmd+S）保存当前文件的全部文案修改。保存完成后，恢复基准更新，当前撤销记录清空。命令「保存当前 HTML」默认未绑定全局快捷键，可在「设置 → 快捷键」中自行指定。
- 编辑框内 Ctrl+Z / Cmd+Z 撤销本次编辑历史；最多保留 200 步。暂不提供重做。
- 打开或切换 HTML 时，右侧栏自动显示并跟随当前 HTML。手动收起后，普通输入或刷新不会强制展开；再次打开 HTML 或选择文案会展开。
- 切换到 Markdown 等文件后，HTML 面板显示空状态；已有的大纲、反向链接等侧栏面板不被删除。

## 保存和草稿

保存只替换源文件中被修改的文字位置。未修改的标签、属性、注释、样式、换行格式和实体写法保持原样。用户输入的 `<`、`>`、`&` 会按文字保存，不会被当成新 HTML 标签。

未保存修改会自动备份到插件目录的 `data.json`，不会自动写回 HTML。关闭标签、切换文件或重启后重新打开 HTML，可恢复文案草稿。因此当前版本关闭标签时直接保留草稿，不弹出保存确认。原始 HTML 仍以上次明确保存的内容为准。

如果文件被其他程序修改，插件不会覆盖它。右侧会提供「另存草稿」和「重新载入原文件」：先另存可保留编辑结果，再重新载入最新文件。「重新载入」需要确认，会放弃该文件的未保存文案。

插件的草稿备份包含原 HTML 文本，仅保存在本地插件数据中；若你的同步工具同步插件目录，草稿也会随之同步。删除插件目录前应先保存需要保留的草稿。

## 功能范围

- 支持静态 HTML 中的标题、段落、链接文字、`button` 文字及其他可见文字节点。
- 页面中的内联样式、本地相对路径样式和图片按原文件目录解析；网络资源需要网络可用。Obsidian 特有资源路径的实际兼容性需在目标库中确认。
- 为保留嵌套格式，带加粗、链接或 `<br>` 的段落按原有文字节点分段编辑。输入换行遵循原 HTML 的空白规则，不自动新增 `<br>`。
- 不执行网页 JavaScript，不支持依赖脚本才生成的页面、交互应用或脚本绘制的图表。表单提交和内嵌网页不执行。
- 当前不编辑图片、链接地址、CSS、`input` 的 value、SVG 内部文字、隐藏区域或 HTML 结构。
- 编辑模式点击链接或按钮用于选择文案，不触发跳转。预览模式支持页内锚点，以及由用户点击打开的 HTTP(S) / 邮件链接；不提供本地 HTML 链接导航。
- 清空文字后，在保存前仍可从当前面板恢复或撤销；保存为空后该位置不再是可选择文字，需要在源文件中重新添加。
- 当前面向桌面使用，未针对手机和平板适配。

## 源码开发

源码包包括完整 TypeScript、样式、测试和锁定依赖文件：

```sh
npm ci
npm run lint
npm run check
npm test
npm run build
node tests/browser-check.mjs
```

浏览器测试默认使用 Windows 上的 Microsoft Edge。其他位置可通过 `HTML_ATELIER_BROWSER` 指定 Chromium 浏览器可执行文件。构建后的 `main.js` 与 `manifest.json`、`styles.css` 即为运行所需文件。第三方依赖许可见 `THIRD-PARTY-NOTICES.txt`。
