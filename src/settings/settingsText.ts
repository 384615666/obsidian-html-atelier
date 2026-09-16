// 44 项设置的双语名称与说明(§8.1;D2 前置的 i18n 基线)
export interface SettingText {name:string; desc:string}

const ZH:Record<string,SettingText>={
 'sidebar.autoShowHtml':{name:'打开 HTML 时显示专属面板',desc:'激活 HTML 文件时自动展开 HTML Atelier 侧栏。工具栏放在侧栏时,即使此项关闭也会展开(否则没有模式切换入口)。'},
 'sidebar.closeOnLeave':{name:'离开 HTML 时关闭面板',desc:'切换到其他文件类型时移除本插件管理的侧栏叶子。'},
 'sidebar.markdownTarget':{name:'切到 Markdown 时',desc:'选择展示原生大纲、恢复旧面板或不动作。'},
 'sidebar.otherTarget':{name:'切到其他文件时',desc:'恢复旧面板或不动作。'},
 'sidebar.respectManualCollapse':{name:'记住手动收起',desc:'手动收起右侧栏后,自动行为不再展开;显式命令可解除。'},
 'sidebar.defaultTab':{name:'默认标签',desc:'HTML 侧栏初始显示的标签页。'},
 'links.externalTarget':{name:'外链打开方式',desc:'系统浏览器或应用内网页查看器;查看器不可用时自动回退。'},
 'links.internalTarget':{name:'库内链接打开方式',desc:'当前标签或新标签页。'},
 'links.respectBlankTarget':{name:'遵循 target=_blank',desc:'页面声明新窗口目标时在新标签页打开。'},
 'links.browserGesture':{name:'浏览器打开手势',desc:'按住修饰键点击链接在浏览器中打开。'},
 'links.showHoverTarget':{name:'悬停显示目标地址',desc:'悬停或键盘聚焦链接时在状态栏显示完整目标。'},
 'links.browserApplication':{name:'浏览器程序',desc:'auto 使用系统默认;也可指定浏览器应用路径(本地含中文/空格路径时建议显式指定)。'},
 'links.unsavedBrowserAction':{name:'有未保存草稿时',desc:'在浏览器打开前询问,或仅打开已保存版本。'},
 'editor.defaultMode':{name:'默认模式',desc:'打开 HTML 文件时的初始模式。'},
 'editor.defaultTextMode':{name:'默认文字编辑粒度',desc:'文字片段或整段编辑。'},
 'editor.historyLimit':{name:'撤销历史上限',desc:'50–1000 个事务;同时受内存预算限制。'},
 'editor.mergeDelayMs':{name:'输入合并窗口',desc:'连续输入合并为一次撤销的时间窗(300–2000ms)。'},
 'editor.showChangeHighlights':{name:'显示修改标记',desc:'页面上高亮已修改文字。'},
 'editor.restoreFocusAfterSave':{name:'保存后恢复焦点',desc:'保存成功后恢复此前的选择与编辑位置。'},
 'editor.toolbarPlacement':{name:'工具栏位置',desc:'侧栏:主视图只留页面内容,模式与导航控件放在 HTML 侧栏面板顶部;视图内:沿用文件视图顶部那条工具栏。'},
 'search.includeHidden':{name:'搜索包含隐藏文字',desc:'隐藏内容会标注“当前不可见”并提供源码定位。'},
 'preview.defaultWidth':{name:'默认预览宽度',desc:'auto 或 240–3840 CSS 像素。'},
 'preview.defaultZoom':{name:'默认缩放',desc:'25%–200%。'},
 'preview.rememberViewport':{name:'记住每文件尺寸',desc:'按文件记忆预览宽度与缩放(高度由布局决定)。'},
 'preview.rememberPosition':{name:'记住阅读位置',desc:'重新打开时恢复到上次阅读位置。'},
 'preview.positionLimit':{name:'位置记忆上限',desc:'为最近多少个文件保存阅读位置。'},
 'preview.autoRefreshAssets':{name:'依赖变化自动刷新',desc:'关联 CSS/图片变化后自动刷新预览。'},
 'preview.allowNetworkAssets':{name:'允许加载网络资源',desc:'关闭后拦截远程图片/样式/字体;页面脚本始终不执行。'},
 'drafts.enabled':{name:'启用草稿备份',desc:'关闭前列出现存草稿,要求先保存或放弃。'},
 'drafts.debounceMs':{name:'草稿防抖',desc:'连续输入后多少毫秒提交一次草稿快照。'},
 'drafts.maxWaitMs':{name:'草稿最长等待',desc:'自首次待写起的最长提交间隔,不小于防抖值。'},
 'drafts.storageWarningMiB':{name:'草稿容量提醒',desc:'草稿总量超过该值时在管理器提示。'},
 'drafts.closeBehavior':{name:'关闭文件时',desc:'保留草稿或每次询问;备份关闭时强制询问。'},
 'saveAs.rebaseRelativeUrls':{name:'另存时重写相对引用',desc:'跨目录另存时按新目录改写本地相对 src/href 等。'},
 'saveAs.openCopy':{name:'保存后打开副本',desc:'另存成功后自动打开副本。'},
 'embeds.enabled':{name:'启用 HTML 嵌入',desc:'处理 Markdown 中的 html-atelier 代码块。'},
 'embeds.defaultHeight':{name:'嵌入默认高度',desc:'160–1600 像素,或由代码块 height 指定。'},
 'embeds.autoHeightMax':{name:'自适应高度上限',desc:'height:auto 时的最大高度。'},
 'embeds.showToolbar':{name:'嵌入工具栏',desc:'显示文件名、刷新与打开编辑。'},
 'embeds.showDrafts':{name:'嵌入显示草稿',desc:'存在未保存草稿时在嵌入标题处标记“草稿”。'},
 'source.lineNumbers':{name:'源码行号',desc:'源码编辑器显示行号。'},
 'source.lineWrapping':{name:'源码软换行',desc:'长行自动换行显示,不改变实际换行。'},
 'source.previewDelayMs':{name:'源码刷新延迟',desc:'源码编辑后到预览刷新的防抖时长(150–2000ms)。'},
 'ui.language':{name:'界面语言',desc:'auto 跟随 Obsidian 语言;可选中文或英文。'},
};

const GROUP_NAMES:Record<string,string>={
 sidebar:'侧栏',links:'链接',editor:'编辑',search:'搜索',preview:'预览',
 drafts:'草稿',saveAs:'另存',embeds:'嵌入',source:'源码',ui:'通用',
};

const EN:Record<string,SettingText>={
 'sidebar.autoShowHtml':{name:'Show panel when opening HTML',desc:'Reveal the HTML Atelier sidebar when an HTML file becomes active. When the toolbar lives in the sidebar, the panel opens regardless (otherwise there would be no mode switch).'},
 'sidebar.closeOnLeave':{name:'Close panel when leaving HTML',desc:'Remove the plugin-owned sidebar leaf when switching to other file types.'},
 'sidebar.markdownTarget':{name:'When switching to Markdown',desc:'Show the native outline, restore the previous panel, or do nothing.'},
 'sidebar.otherTarget':{name:'When switching to other files',desc:'Restore the previous panel or do nothing.'},
 'sidebar.respectManualCollapse':{name:'Remember manual collapse',desc:'After manually collapsing the sidebar, automation will not expand it; explicit command can.'},
 'sidebar.defaultTab':{name:'Default tab',desc:'Initial tab shown in the HTML sidebar.'},
 'links.externalTarget':{name:'External links',desc:'System browser or in-app web viewer; falls back when unavailable.'},
 'links.internalTarget':{name:'Library links',desc:'Open in the current tab or a new tab.'},
 'links.respectBlankTarget':{name:'Honor target=_blank',desc:'Open in a new tab when the page declares a new-window target.'},
 'links.browserGesture':{name:'Browser-open gesture',desc:'Hold a modifier and click a link to open it in the browser.'},
 'links.showHoverTarget':{name:'Hover shows target',desc:'Show the full target in the status bar on hover or keyboard focus.'},
 'links.browserApplication':{name:'Browser application',desc:'auto uses the system default; or specify a browser app path (recommended for non-ASCII paths).'},
 'links.unsavedBrowserAction':{name:'With unsaved draft',desc:'Ask before opening in browser, or open the saved version only.'},
 'editor.defaultMode':{name:'Default mode',desc:'Initial mode when opening an HTML file.'},
 'editor.defaultTextMode':{name:'Default text granularity',desc:'Text segment or whole-paragraph editing.'},
 'editor.historyLimit':{name:'Undo history limit',desc:'50–1000 transactions; also bounded by memory budget.'},
 'editor.mergeDelayMs':{name:'Input merge window',desc:'Consecutive inputs merge into one undo within this window (300–2000ms).'},
 'editor.showChangeHighlights':{name:'Show change highlights',desc:'Highlight modified text on the page.'},
 'editor.restoreFocusAfterSave':{name:'Restore focus after save',desc:'Restore the previous selection and editing position after saving.'},
 'editor.toolbarPlacement':{name:'Toolbar location',desc:'Sidebar: the main view shows page content only, and mode/navigation controls sit at the top of the HTML sidebar panel. In view: keep the toolbar above the file view.'},
 'search.includeHidden':{name:'Search hidden text',desc:'Hidden content is marked “currently hidden” with source location.'},
 'preview.defaultWidth':{name:'Default preview width',desc:'auto or 240–3840 CSS pixels.'},
  'preview.defaultZoom':{name:'Default zoom',desc:'25%–200%.'},
 'preview.rememberViewport':{name:'Remember per-file viewport',desc:'Remember preview width and zoom per file (height follows the layout).'},
 'preview.rememberPosition':{name:'Remember reading position',desc:'Restore the last reading position when reopening.'},
 'preview.positionLimit':{name:'Position memory limit',desc:'How many recent files keep reading positions.'},
 'preview.autoRefreshAssets':{name:'Auto-refresh on asset change',desc:'Refresh the preview when linked CSS/images change.'},
 'preview.allowNetworkAssets':{name:'Allow network assets',desc:'When off, remote images/styles/fonts are blocked; page scripts never run.'},
 'drafts.enabled':{name:'Enable draft backup',desc:'Existing drafts are listed before turning off; save or discard first.'},
 'drafts.debounceMs':{name:'Draft debounce',desc:'Milliseconds of idle before a draft snapshot is committed.'},
 'drafts.maxWaitMs':{name:'Draft max wait',desc:'Maximum commit interval since the first pending write; not below debounce.'},
 'drafts.storageWarningMiB':{name:'Draft size warning',desc:'Warn in the manager when total drafts exceed this size.'},
 'drafts.closeBehavior':{name:'When closing a file',desc:'Keep drafts or ask each time; forced to ask when backup is off.'},
 'saveAs.rebaseRelativeUrls':{name:'Rewrite relative references on save-as',desc:'Rewrite local relative src/href for the new directory when saving across folders.'},
 'saveAs.openCopy':{name:'Open copy after saving',desc:'Open the copy automatically after saving.'},
 'embeds.enabled':{name:'Enable HTML embeds',desc:'Process html-atelier code blocks in Markdown.'},
 'embeds.defaultHeight':{name:'Embed default height',desc:'160–1600 pixels; can be overridden by block height.'},
 'embeds.autoHeightMax':{name:'Auto-height cap',desc:'Maximum height when height is auto.'},
 'embeds.showToolbar':{name:'Embed toolbar',desc:'Show file name, refresh and open-in-editor.'},
 'embeds.showDrafts':{name:'Embeds show drafts',desc:'Mark “draft” in the embed header when unsaved changes exist.'},
 'source.lineNumbers':{name:'Source line numbers',desc:'Show line numbers in the source editor.'},
 'source.lineWrapping':{name:'Source soft wrap',desc:'Wrap long lines visually without changing them.'},
 'source.previewDelayMs':{name:'Source refresh delay',desc:'Debounce from source edits to preview refresh (150–2000ms).'},
 'ui.language':{name:'Interface language',desc:'auto follows Obsidian; or force Chinese/English.'},
};

const GROUP_NAMES_EN:Record<string,string>={
 sidebar:'Sidebar',links:'Links',editor:'Editing',search:'Search',preview:'Preview',
 drafts:'Drafts',saveAs:'Save as',embeds:'Embeds',source:'Source',ui:'General',
};

export function settingsText(group:string,key:string):SettingText|null{
 const path=key?`${group}.${key}`:'';
 const zh=ZH[path];
 const en=EN[path];
 if(key)return zh&&en?{name:zh.name,desc:zh.desc}:null;
 return {name:GROUP_NAMES[group]??group,desc:''};
}

export function settingsTextEn(group:string,key:string):SettingText|null{
 const path=key?`${group}.${key}`:'';
 const zh=ZH[path];
 const en=EN[path];
 if(key)return zh&&en?{name:en.name,desc:en.desc}:null;
 return {name:GROUP_NAMES_EN[group]??group,desc:''};
}

// ---- 枚举设置的可选值显示名 ----
// 存进 data.json 的仍是标识符(不能改,改了老配置全部失效),但**给用户看**的必须是
// 本地化文字 —— 中文界面里显示 "outline / previous / none" 是看不懂的(用户反馈 2026-09-15)。
// 按 `组.键` 登记而不是按值:同一个标识符在不同设置里含义不同 ——
// 'outline' 在 sidebar.markdownTarget 是"展示原生大纲",在 sidebar.defaultTab 是"大纲"标签;
// 'edit' 在 editor.defaultMode 是"编辑"模式,在 defaultTab 是"编辑"标签。
// 键集合必须与 schema 的 ENUM_VALUES 完全一致(单测强制)。
const OPTIONS_ZH:Record<string,Record<string,string>>={
 'sidebar.markdownTarget':{outline:'展示原生大纲',previous:'恢复旧面板',none:'不动作'},
 'sidebar.otherTarget':{previous:'恢复旧面板',none:'不动作'},
 'sidebar.defaultTab':{edit:'编辑',outline:'大纲',changes:'修改',resources:'资源'},
 'links.externalTarget':{browser:'系统浏览器','web-viewer':'应用内网页查看器'},
 'links.internalTarget':{current:'当前标签页','new-tab':'新标签页'},
 'links.browserGesture':{Mod:'Ctrl/Cmd + 点击',Alt:'Alt + 点击','Mod+Shift':'Ctrl/Cmd + Shift + 点击',off:'关闭'},
 'links.unsavedBrowserAction':{ask:'先询问',saved:'只打开已保存的版本'},
 'editor.defaultMode':{preview:'预览',edit:'编辑',source:'源码',split:'分栏'},
 'editor.defaultTextMode':{segment:'文字片段',paragraph:'整段'},
 'editor.toolbarPlacement':{sidebar:'侧栏面板',view:'视图内'},
 'drafts.closeBehavior':{keep:'保留草稿',ask:'每次询问'},
 'ui.language':{auto:'跟随 Obsidian','zh-CN':'中文',en:'English'},
};

const OPTIONS_EN:Record<string,Record<string,string>>={
 'sidebar.markdownTarget':{outline:'Show the native outline',previous:'Restore the previous panel',none:'Do nothing'},
 'sidebar.otherTarget':{previous:'Restore the previous panel',none:'Do nothing'},
 'sidebar.defaultTab':{edit:'Edit',outline:'Outline',changes:'Changes',resources:'Resources'},
 'links.externalTarget':{browser:'System browser','web-viewer':'In-app web viewer'},
 'links.internalTarget':{current:'Current tab','new-tab':'New tab'},
 'links.browserGesture':{Mod:'Ctrl/Cmd + click',Alt:'Alt + click','Mod+Shift':'Ctrl/Cmd + Shift + click',off:'Off'},
 'links.unsavedBrowserAction':{ask:'Ask first',saved:'Open the saved version only'},
 'editor.defaultMode':{preview:'Preview',edit:'Edit',source:'Source',split:'Split'},
 'editor.defaultTextMode':{segment:'Text segment',paragraph:'Whole paragraph'},
 'editor.toolbarPlacement':{sidebar:'Sidebar panel',view:'In the view'},
 'drafts.closeBehavior':{keep:'Keep drafts',ask:'Ask each time'},
 'ui.language':{auto:'Follow Obsidian','zh-CN':'Chinese',en:'English'},
};

// "恢复本组默认"按钮文案(设置页此前硬编码中文,英文界面会露中文)
export const RESTORE_GROUP_TEXT={zh:'恢复本组默认',en:'Restore group defaults'};

export function settingsOptions(group:string,key:string):Record<string,string>|null{
 return OPTIONS_ZH[`${group}.${key}`]??null;
}

export function settingsOptionsEn(group:string,key:string):Record<string,string>|null{
 return OPTIONS_EN[`${group}.${key}`]??null;
}
