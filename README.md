# HTML Atelier

[简体中文](#html-atelier中文说明)

Preview and edit static HTML files in Obsidian. Open pages in the main workspace, edit text, links and images visually, and use the sidebar workbench to navigate headings, search content, review changes and inspect resources.

Visual edits update the affected source ranges without reformatting the entire file. Page scripts do not run in the plugin's preview.

Requires **Obsidian Desktop 1.7.2 or later**. Supports `.html` and `.htm` files, with interface options for English and 简体中文.

## Features

### Preview & navigation

- Preview static HTML in a sandboxed frame with page scripts disabled.
- Zoom in, zoom out or reset the zoom, and adjust the page width for reading or checking layouts.
- Local stylesheets referenced by `<link rel="stylesheet">` and CSS `@import` are inlined into the preview. Relative images and other assets resolve from the page's folder; references inside CSS resolve from the stylesheet's folder.
- Follow page anchors and links to other vault files. Back and forward navigation remembers each page's scroll position by default.
- Referenced local assets can refresh the preview automatically when they change.

### Editing

- **Visual editing**: switch to **Edit**, select text, a link or an image on the page, and edit it in the sidebar. Text segment changes update the preview as you type.
- **Text segments & paragraphs**: edit individual text nodes, or switch to paragraph editing to work across inline formatting. Paragraph mode supports line breaks; if a paragraph cannot be mapped to the source, use segment editing instead.
- **Links**: edit link text and destination addresses, or choose an HTML file from the vault.
- **Images**: edit image addresses and alternative text (`alt`), choose an image from the vault, or import an external image.
- **Source mode**: edit the raw HTML with line numbers and optional line wrapping.
- **Split mode**: source and preview side by side.
- Unaffected source ranges keep their original tags, attributes, comments, indentation, line endings and entity spellings.
- Undo and redo with grouped typing and a configurable history limit of 200 entries by default.
- Changes are written to the HTML file when you save. Draft backups are separate from saving.

### Sidebar workbench

- **Edit**: forms for the selected text, link or image.
- **Outline**: heading navigation and a text list for jumping to content.
- **Search**: find and replace text in the current page draft, with case matching and an option to include hidden text. Replacement skips matches that span formatting boundaries.
- **Changes**: compare pending text changes, locate them, and restore text entries where supported. Non-text edits may appear as a source summary; use undo or source mode for changes without per-entry restore.
- **Resources**: inspect referenced assets, check local / missing / remote / blocked status, and jump to the source.

The workbench also shows file and draft status. The toolbar appears in the sidebar by default and can be moved to the main view in settings.

### Drafts & conflicts

- Draft backups are enabled by default. Unsaved edits are backed up after a short delay and restored when the file is reopened, including after a restart. Backups are identified by device.
- If the file changes on disk while you have unsaved edits, the plugin detects a conflict before saving. You can use a three-way **merge**, adopt the disk version, or save the draft as a separate file.
- The **draft manager**, available from the toolbar's **More** menu, lists backups and lets you discard selected drafts without deleting the original HTML files.
- **Save as** creates a copy of the current draft, including unsaved edits, with an option to adjust local relative references when saving to another folder. Asset files themselves are not copied.

Backups are stored under `.obsidian/plugins/html-atelier/drafts/` by default. They contain the original and edited HTML; if your sync tool includes the plugin folder, it may sync these backups too. Save any drafts you need before removing the plugin folder.

### Notes integration

- Embed a saved HTML page in a note with an `html-atelier` code block:

  ````
  ```html-atelier
  path: "Pages/weekly-report.html"
  height: auto
  anchor: summary
  ```
  ````

  | Parameter | Meaning |
  | --- | --- |
  | `path` | Required: path to an HTML file relative to the vault root. |
  | `height` | `auto` or an integer pixel value (160–1600). Automatic height is capped by the embed settings. |
  | `width` | `auto` or an integer pixel value (240–3840), constrained by the available note width. |
  | `anchor` | Optional: scroll to an element's `id`, without a leading `#`. |
  | `toolbar` | `false` hides the embed's open and refresh buttons. |

  Embeds read the saved file rather than the current unsaved draft. After saving changes, use the embed's refresh button to reload it.

- Wiki links and Markdown links to HTML files open in the plugin's view with fragment scrolling.
- Copy a page link, a section link or an embed code block from the toolbar menu. You can also open the current page in an external browser.

## Installation

1. Open **Settings → Community plugins** in Obsidian.
2. Browse community plugins, search for **HTML Atelier**, then install and enable it.
3. Open an `.html` or `.htm` file in your vault. The page opens in the main workspace, with the sidebar workbench shown automatically by default.
4. Switch to **Edit**, select an object on the page, make your changes in the sidebar, and click **Save**.

If another enabled plugin handles `.html` or `.htm` files, disable it first to avoid file registration conflicts.

For manual installation, download `main.js`, `manifest.json` and `styles.css` from the same release on [GitHub Releases](https://github.com/384615666/obsidian-html-atelier/releases) and place them directly in `.obsidian/plugins/html-atelier/`:

```text
.obsidian/plugins/html-atelier/
├── main.js
├── manifest.json
└── styles.css
```

Restart Obsidian, then enable **HTML Atelier** under **Settings → Community plugins**. Avoid an extra nested folder. If your vault uses a custom configuration folder, substitute it for `.obsidian`.

## Editing scope & safety

- Visual editing covers selectable page text, link addresses and image attributes. It is not a general page layout editor; use source mode for CSS, arbitrary HTML structure, form field values and text inside SVG or other excluded elements.
- Segment editing follows the original text nodes. Paragraph editing retains inline tags while changing text across nodes; the distribution of changed text across formatting spans may change.
- In visual text fields, `<`, `>` and `&` are escaped as text. In source mode, you edit HTML directly. Segment line breaks follow HTML whitespace rules; paragraph mode can insert `<br>` line breaks.
- Page scripts and inline event handlers do not run in the plugin's preview. Form submissions are blocked, and nested frames are removed. Pages that rely on JavaScript to generate content or interactions are not supported.
- Remote images, styles, fonts and media are allowed by default in the main preview and in note embeds, and can be blocked in settings.
- Opening a page in an external browser uses that browser's normal behavior, including script execution.
- Desktop only; mobile Obsidian is not supported.

## Development

```sh
npm ci
npm run lint
npm run check
npm test
npm run build
node tests/browser-check.mjs
node tests/sidebar-regression.mjs
```

Browser checks default to Microsoft Edge at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`. Set `HTML_ATELIER_BROWSER` to another Chromium-based browser's executable path if needed.

The build produces `main.js`, including the bundled worker. Install it alongside `manifest.json` and `styles.css`. Third-party licenses are listed in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).

---

# HTML Atelier（中文说明）

[English](#html-atelier)

在 Obsidian 中预览和编辑静态 HTML 文件。在主工作区打开页面，可视化修改文字、链接和图片，通过侧栏工作台浏览大纲、搜索内容、查看改动与检查资源。

可视化编辑只更新受影响的源码区间，不会重新格式化整份文件。插件预览中不执行页面脚本。

适用于 **Obsidian 桌面版 1.7.2 及以上**，支持 `.html` 和 `.htm` 文件，界面可选择简体中文或 English。

## 功能特性

### 预览与导航

- 在沙箱框架中预览静态 HTML，禁用页面脚本。
- 支持放大、缩小和重置缩放，可调整页面宽度，方便阅读与检查布局。
- 通过 `<link rel="stylesheet">` 和 CSS `@import` 引用的库内样式表会内联到预览中。图片等相对资源按页面所在目录解析，CSS 内的相对资源按样式表所在目录解析。
- 支持页内锚点和库内文件链接；后退、前进导航默认记住每页的滚动位置。
- 引用的本地资源发生变化时，可自动刷新预览。

### 编辑

- **可视化编辑**：切换到「编辑」，选择页面中的文字、链接或图片，在侧栏修改。文字片段的修改会随输入更新预览。
- **文字片段与整段编辑**：可以逐个编辑文字节点，也可以切换到整段编辑，跨越内联格式修改文字。整段模式支持换行；无法映射到源码的段落可改用片段编辑。
- **链接**：修改链接文字和目标地址，或从库中选择 HTML 文件。
- **图片**：修改图片地址和替代文本（`alt`），选择库内图片，或导入外部图片。
- **源码模式**：直接编辑 HTML，支持行号和可选的自动换行显示。
- **分栏模式**：源码与预览并排。
- 未受影响的源码区间保留原有标签、属性、注释、缩进、换行格式和实体写法。
- 支持撤销、重做，连续输入自动分组；历史记录数量可配置，默认上限为 200 条。
- 点击保存后才会将改动写回 HTML 文件；草稿备份与文件保存是两回事。

### 侧栏工作台

- **编辑**：按所选对象显示文字、链接或图片表单。
- **大纲**：浏览标题与文字列表，点击跳转。
- **搜索**：在当前页面草稿中查找、替换文字，支持区分大小写，并可选择包含隐藏文字。跨越格式边界的匹配会在替换时跳过。
- **修改**：对照未保存的文字改动，定位修改位置，并恢复支持还原的文字条目。非文字改动可能以源码摘要显示；无法逐条恢复的改动可通过撤销或源码模式处理。
- **资源**：查看引用的资源及其本地、缺失、远程或已拦截状态，跳转到对应源码。

工作台还显示文件与草稿状态。工具栏默认位于侧栏，也可在设置中移到主视图。

### 草稿与冲突

- 草稿备份默认开启。未保存的修改会在短暂延迟后自动备份，重新打开文件时恢复，包括重启 Obsidian 后。备份按设备标记。
- 存在未保存修改时，如果磁盘文件发生变化，插件会在保存前检测冲突。可选择三方**合并**、采用磁盘版本，或将草稿另存为独立文件。
- 在工具栏的「更多」菜单中打开**草稿管理器**，查看备份并丢弃选中的草稿，不会删除原始 HTML 文件。
- **另存为**保存当前草稿的副本，包括未保存的修改。跨目录另存时，可调整本地相对引用，使其仍指向原来的目标；不会复制资源文件本身。

备份默认存放在 `.obsidian/plugins/html-atelier/drafts/`，包含原始 HTML 和编辑后的内容。如果同步工具包含插件目录，这些备份也可能被同步。删除插件目录前，请先保存需要保留的草稿。

### 与笔记集成

- 用 `html-atelier` 代码块在笔记中嵌入已保存的 HTML 页面：

  ````
  ```html-atelier
  path: "页面/周报.html"
  height: auto
  anchor: summary
  ```
  ````

  | 参数 | 含义 |
  | --- | --- |
  | `path` | 必填，相对于库根目录的 HTML 文件路径。 |
  | `height` | `auto` 或整数像素值（160–1600）；自动高度受嵌入设置中的上限约束。 |
  | `width` | `auto` 或整数像素值（240–3840），不超过笔记的可用宽度。 |
  | `anchor` | 可选，滚动到指定元素的 `id`，不需要前面的 `#`。 |
  | `toolbar` | 设为 `false` 时隐藏嵌入的打开与刷新按钮。 |

  嵌入读取已保存文件，不显示当前未保存草稿。保存修改后，可点击嵌入的刷新按钮重新载入。

- Wiki 链接与 Markdown 链接指向 HTML 文件时，在插件视图内打开并滚动到对应锚点。
- 工具栏菜单可复制页面链接、小节链接或嵌入代码块，也可在外部浏览器打开当前页。

## 安装

1. 在 Obsidian 中打开「设置 → 第三方插件」，进入「社区插件市场」。
2. 搜索「HTML Atelier」，安装并启用。
3. 打开库内的 `.html` 或 `.htm` 文件，页面在主工作区显示，侧栏工作台默认自动打开。
4. 切换到「编辑」，选择页面中的对象，在侧栏修改，然后点击「保存」。

如果已启用其他接管 `.html` 或 `.htm` 文件的插件，请先停用，避免文件类型注册冲突。

手动安装时，从 [GitHub Releases](https://github.com/384615666/obsidian-html-atelier/releases) 的同一版本下载 `main.js`、`manifest.json` 和 `styles.css`，直接放入 `.obsidian/plugins/html-atelier/`：

```text
.obsidian/plugins/html-atelier/
├── main.js
├── manifest.json
└── styles.css
```

重启 Obsidian 后，在「设置 → 第三方插件」中启用「HTML Atelier」。不要再套一层文件夹；如果库使用了自定义配置目录，请将 `.obsidian` 替换为实际目录。

## 编辑范围与安全

- 可视化编辑支持可选择的页面文字、链接地址与图片属性，不提供通用的页面布局编辑。CSS、任意 HTML 结构、表单字段值，以及 SVG 等排除元素内的文字，请使用源码模式修改。
- 片段编辑遵循原有文字节点；整段编辑保留内联标签，但修改后的文字在格式区间之间的分布可能变化。
- 可视化文字输入中的 `<`、`>`、`&` 会转义为文字；源码模式则直接编辑 HTML。片段中的换行遵循 HTML 空白规则，整段模式可插入 `<br>` 换行。
- 插件预览不执行页面脚本与内联事件处理代码，禁止表单提交，并移除内嵌框架。不支持依赖 JavaScript 生成内容或实现交互的页面。
- 主预览与笔记嵌入默认允许加载远程图片、样式、字体和媒体，可在设置中统一关闭。
- 在外部浏览器打开页面时，遵循浏览器的正常行为，包括执行页面脚本。
- 仅支持桌面版 Obsidian，不支持移动端。

## 源码开发

```sh
npm ci
npm run lint
npm run check
npm test
npm run build
node tests/browser-check.mjs
node tests/sidebar-regression.mjs
```

浏览器测试默认使用 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`。需要使用其他位置或其他基于 Chromium 的浏览器时，可通过 `HTML_ATELIER_BROWSER` 指定可执行文件路径。

构建生成 `main.js`，其中已包含打包后的 Worker；安装时与 `manifest.json`、`styles.css` 一同使用。第三方依赖许可见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。
