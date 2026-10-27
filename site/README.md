# HTML Atelier 产品主页

`site/` 是 HTML Atelier 的静态产品主页，无构建步骤、无外部 CDN 或字体，直接由 `index.html`、`site.css`、`site.js` 和本地素材组成。

## 本地预览

在仓库根目录运行：

```sh
python -m http.server 8899 --directory site
```

然后打开 <http://127.0.0.1:8899/>。

不要直接双击 `index.html`：主页里的交互演示和截图使用相对路径，通过本地 HTTP 服务查看最接近线上效果。

## 部署到 GitHub Pages

仓库带一个**自动部署**工作流 [`.github/workflows/pages.yml`](../.github/workflows/pages.yml)：推送 `site/` 下的任何文件（或工作流本身）到 `main`，就会自动把 `site/` 上传并发布为 Pages 站点。

1. 在 GitHub 仓库的 **Settings → Pages** 中，把 **Source** 设为 **GitHub Actions**（已配置）。
2. 修改 `site/` 后推送到 `main`，等 **Actions → Deploy product site** 跑完即可。
3. 站点地址为 <https://384615666.github.io/obsidian-html-atelier/>；也可以在 Actions 页面手动运行一次。

`docs/` 是内部设计与审计文档，不要把它设为 Pages 发布目录。

如果站点改到其他域名，记得同步修改 `index.html` 里的 canonical、`og:url`、`og:image` 和 `sitemap.xml`。

## 素材与再生成

| 文件 | 来源 / 说明 |
| --- | --- |
| `assets/icon.svg`、`icon-180.png`、`icon-256.png`、`icon-512.png` | 品牌图标（焦糖底 + `</>`）。 |
| `assets/cup.svg` | 演示页与首屏插画，来自 `promo/build/我的笔记/页面/assets/cup.svg`。 |
| `assets/shot-edit.webp` 等 4 组 | 真实界面截图，来自 `promo/build/explore/` 与 `promo/build/explore-scenes/`；每组含 1600w 与 900w 两档 WebP。 |
| `assets/og-cover.png` | 1200×630 社交分享封面。源文件在 `site/tools/og-cover.html`。 |

重新生成分享封面：

```sh
node site/tools/render-og.mjs
```

需要 `playwright-core`（本仓库的 devDependency）和 Chromium 内核浏览器；默认使用 Edge，可用 `HTML_ATELIER_BROWSER` 指定其他可执行文件。

## 内容约束

- 产品事实以仓库根目录的 [README.md](../README.md) 和 `manifest.json` 为准；改文案时不要加入未实现的功能。
- 交互演示只模拟 UI 状态，不读写用户文件；演示页内容是 `promo/build/我的笔记/页面/一杯好咖啡的诞生.html` 的精简复用。
- 页面默认浅色主题，`prefers-reduced-motion` 下关闭入场动画。
- 新增截图请同时提供 900w 与 1600w，并保留 16:9 比例。
