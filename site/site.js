(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* =========================================================================
     Sticky navigation, mobile menu, scrollspy
     ========================================================================= */
  const nav = document.getElementById("siteNav");
  const navToggle = document.getElementById("navToggle");
  const navMenu = document.getElementById("navMenu");

  const setNavState = () => {
    if (!nav) return;
    nav.classList.toggle("is-scrolled", window.scrollY > 10);
  };

  setNavState();
  window.addEventListener("scroll", setNavState, { passive: true });

  const mobileQuery = window.matchMedia("(max-width: 980px)");
  const isMenuOpen = () => Boolean(nav && nav.classList.contains("is-open"));

  const setMenu = (open, returnFocus = false) => {
    if (!nav || !navToggle) return;
    nav.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
    if (!open && returnFocus) navToggle.focus();
  };

  if (navToggle && navMenu) {
    navToggle.addEventListener("click", () => setMenu(!isMenuOpen()));

    navMenu.addEventListener("click", (event) => {
      if (event.target.closest("a")) setMenu(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isMenuOpen()) setMenu(false, true);
    });

    document.addEventListener("pointerdown", (event) => {
      if (isMenuOpen() && nav && !nav.contains(event.target)) setMenu(false);
    });

    if (typeof mobileQuery.addEventListener === "function") {
      mobileQuery.addEventListener("change", (event) => {
        if (!event.matches) setMenu(false);
      });
    }
  }

  const sectionLinks = navMenu
    ? Array.from(navMenu.querySelectorAll('a[href^="#"]'))
    : [];

  const spySections = [];
  sectionLinks.forEach((link) => {
    const id = link.getAttribute("href").slice(1);
    const section = document.getElementById(id);
    if (section) spySections.push({ link, section });
  });

  if (spySections.length && "IntersectionObserver" in window) {
    const setActive = (activeLink) => {
      sectionLinks.forEach((link) => {
        const active = link === activeLink;
        link.classList.toggle("is-active", active);
        if (active) {
          link.setAttribute("aria-current", "location");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    };

    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const found = spySections.find((item) => item.section === entry.target);
          if (found) setActive(found.link);
        });
      },
      { rootMargin: "-42% 0px -52% 0px", threshold: 0 }
    );

    spySections.forEach((item) => spy.observe(item.section));

    window.addEventListener(
      "scroll",
      () => {
        if (window.scrollY < 160) {
          sectionLinks.forEach((link) => {
            link.classList.remove("is-active");
            link.removeAttribute("aria-current");
          });
        }
      },
      { passive: true }
    );
  }

  /* =========================================================================
     Reveal on scroll (content stays visible without JS)
     ========================================================================= */
  const revealItems = Array.from(document.querySelectorAll("[data-reveal]"));

  if (!reduceMotion && "IntersectionObserver" in window && revealItems.length) {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -7% 0px", threshold: 0.06 }
    );

    revealItems.forEach((item) => revealObserver.observe(item));
  }

  /* =========================================================================
     Screenshot lightbox
     ========================================================================= */
  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxCaption = document.getElementById("lightboxCaption");
  const lightboxClose = document.getElementById("lightboxClose");
  const shotCards = Array.from(document.querySelectorAll(".shot-card"));

  if (lightbox && lightboxImage && lightboxCaption && shotCards.length) {
    const closeLightbox = () => {
      if (lightbox.open) lightbox.close();
    };

    shotCards.forEach((card) => {
      card.addEventListener("click", () => {
        const full = card.getAttribute("data-full");
        const caption = card.getAttribute("data-caption") || "";
        const innerImage = card.querySelector("img");

        if (!full) return;

        lightboxImage.src = full;
        lightboxImage.alt = innerImage ? innerImage.alt : caption;
        lightboxCaption.textContent = caption;

        if (typeof lightbox.showModal === "function") {
          lightbox.showModal();
        } else {
          lightbox.setAttribute("open", "");
        }

        document.body.classList.add("lightbox-open");
        window.requestAnimationFrame(() => {
          if (lightboxClose) lightboxClose.focus();
        });
      });
    });

    lightboxClose?.addEventListener("click", closeLightbox);

    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) closeLightbox();
    });

    lightbox.addEventListener("close", () => {
      document.body.classList.remove("lightbox-open");
    });
  }
})();

/* ==========================================================================
   Interactive workbench prototype
   ========================================================================== */
(() => {
  "use strict";

  const app = document.getElementById("demoApp");
  const page = document.getElementById("demoPage");
  if (!app || !page) return;

  const pageScroll = document.getElementById("pageScroll");
  const sourceScroll = document.getElementById("sourceScroll");
  const sourceCode = document.getElementById("sourceCode");
  const panelBody = document.querySelector(".panel-body");
  const editForm = document.getElementById("editForm");
  const editEmpty = document.getElementById("editEmpty");
  const outlineList = document.getElementById("outlineList");
  const outlineEmpty = document.getElementById("outlineEmpty");
  const outlineCount = document.getElementById("outlineCount");
  const changesList = document.getElementById("changesList");
  const changesEmpty = document.getElementById("changesEmpty");
  const changesSummary = document.getElementById("changesSummary");
  const changesCount = document.getElementById("changesCount");
  const searchInput = document.getElementById("demoSearch");
  const searchCount = document.getElementById("searchCount");
  const searchHint = document.getElementById("searchHint");
  const dirtyStatus = document.getElementById("dirtyStatus");
  const dirtyDot = document.getElementById("dirtyDot");
  const statusDot = document.getElementById("statusDot");
  const saveBtn = document.getElementById("saveBtn");
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  const previewHint = document.getElementById("previewHint");
  const zoomLabel = document.getElementById("zoomReset");
  const zoomInBtn = document.getElementById("zoomIn");
  const zoomOutBtn = document.getElementById("zoomOut");
  const demoToast = document.getElementById("demoToast");
  const modeButtons = Array.from(document.querySelectorAll(".mode-switch [data-mode]"));
  const tabButtons = Array.from(document.querySelectorAll(".panel-tabs [role='tab']"));
  const tabPanels = Array.from(document.querySelectorAll(".panel-section[role='tabpanel']"));

  if (
    !pageScroll || !sourceScroll || !sourceCode || !panelBody || !editForm ||
    !editEmpty || !outlineList || !changesList || !searchInput
  ) {
    return;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const escapeHTML = (value) =>
    String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapeAttr = (value) => escapeHTML(value).replace(/"/g, "&quot;");
  const truncate = (value, length = 30) => {
    const text = String(value);
    return text.length > length ? `${text.slice(0, length)}…` : text;
  };
  const displayValue = (value) => (String(value) === "" ? "（空）" : String(value));

  /* =========================================================================
     Editable object model
     ========================================================================= */
  const objectDefs = {
    h1: {
      kind: "text",
      label: "标题",
      field: "标题",
      rows: 2,
      initial: { text: "一杯好咖啡的诞生" },
    },
    lead: {
      kind: "text",
      label: "段落",
      field: "文字",
      rows: 3,
      initial: {
        text:
          "从一颗生豆到杯中的风味，要经过选豆、烘焙、研磨与萃取。这份笔记把每一步的要点记下来，下次照着做就好。",
      },
    },
    toc1: {
      kind: "link",
      label: "链接",
      initial: { text: "选豆", href: "#beans" },
    },
    toc2: {
      kind: "link",
      label: "链接",
      initial: { text: "烘焙", href: "#roast" },
    },
    toc3: {
      kind: "link",
      label: "链接",
      initial: { text: "研磨", href: "#grind" },
    },
    toc4: {
      kind: "link",
      label: "链接",
      initial: { text: "萃取", href: "#brew" },
    },
    img: {
      kind: "image",
      label: "图片",
      initial: { src: "assets/cup.svg", alt: "一杯拿铁的俯视图" },
    },
    beansTitle: {
      kind: "text",
      label: "标题",
      field: "标题",
      rows: 2,
      initial: { text: "选豆：风味从产地开始" },
    },
    beansP: {
      kind: "text",
      label: "段落",
      field: "文字",
      rows: 3,
      initial: {
        text:
          "咖啡豆是一种农产品，产地的海拔、气候和处理方式，决定了它最初的味道。先从三个产区开始，找到自己喜欢的方向。",
      },
    },
    card1t: {
      kind: "text",
      label: "标题",
      field: "标题",
      rows: 2,
      initial: { text: "耶加雪菲" },
    },
    card1b: {
      kind: "text",
      label: "段落",
      field: "文字",
      rows: 3,
      initial: { text: "花香与柑橘调明亮，酸质干净，像一杯温热的茉莉花茶。" },
    },
    card2t: {
      kind: "text",
      label: "标题",
      field: "标题",
      rows: 2,
      initial: { text: "慧兰" },
    },
    card2b: {
      kind: "text",
      label: "段落",
      field: "文字",
      rows: 3,
      initial: { text: "焦糖与坚果的甜感扎实，酸甜平衡，适合每天一杯。" },
    },
    card3t: {
      kind: "text",
      label: "标题",
      field: "标题",
      rows: 2,
      initial: { text: "保山小粒" },
    },
    card3b: {
      kind: "text",
      label: "段落",
      field: "文字",
      rows: 3,
      initial: { text: "红糖、可可与淡淡的果干，醇厚温润，是家门口的好豆子。" },
    },
    roastTitle: {
      kind: "text",
      label: "标题",
      field: "标题",
      rows: 2,
      initial: { text: "烘焙：决定一杯咖啡的性格" },
    },
    roastP: {
      kind: "text",
      label: "段落",
      field: "文字",
      rows: 3,
      initial: {
        text:
          "同一支豆子，烘焙程度不同，喝起来判若两杯。浅烘保留更多果酸与花香，深烘则带来可可、焦糖与更厚的醇度。",
      },
    },
    grindTitle: {
      kind: "text",
      label: "标题",
      field: "标题",
      rows: 2,
      initial: { text: "研磨：粗细与新鲜" },
    },
    grindP: {
      kind: "text",
      label: "段落",
      field: "文字",
      rows: 3,
      initial: {
        text:
          "豆子磨开后，香气在十几分钟内就会大量散失，最好冲之前现磨。另外，烘焙后的第 5 到 14 天通常是风味最好的时候。",
      },
    },
    brewTitle: {
      kind: "text",
      label: "标题",
      field: "标题",
      rows: 2,
      initial: { text: "萃取：手冲四步" },
    },
    footLink: {
      kind: "link",
      label: "链接",
      initial: { text: "手冲入门指南", href: "https://example.com/brew-guide" },
    },
  };

  const saved = {};
  const current = {};
  Object.keys(objectDefs).forEach((key) => {
    saved[key] = clone(objectDefs[key].initial);
    current[key] = clone(objectDefs[key].initial);
  });

  const outlineDefs = [
    { key: "h1", level: 1 },
    { key: "beansTitle", level: 2 },
    { key: "card1t", level: 3 },
    { key: "card2t", level: 3 },
    { key: "card3t", level: 3 },
    { key: "roastTitle", level: 2 },
    { key: "grindTitle", level: 2 },
    { key: "brewTitle", level: 2 },
  ];

  /* =========================================================================
     Source template and line map
     ========================================================================= */
  const sourceTemplate = [
    "<!DOCTYPE html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    "  <title>一杯好咖啡的诞生</title>",
    '  <link rel="icon" href="assets/favicon.png">',
    "  <style>",
    "    :root { --paper: #f7f1e8; --ink: #2b211b; --caramel: #b8743f; }",
    "    body { margin: 0; background: var(--paper); color: var(--ink); }",
    '    h1, h2, h3 { font-family: "Noto Serif SC", serif; }',
    "    a { color: var(--caramel); }",
    "  </style>",
    "</head>",
    "<body>",
    '  <header class="hero">',
    '    <p class="eyebrow">周末手冲笔记 · 第 3 期</p>',
    "    <h1>{{h1.text}}</h1>",
    '    <p class="lead">{{lead.text}}</p>',
    "    <p class=\"meta\"><span>阅读约 6 分钟</span><span>2026 年 9 月</span></p>",
    '    <figure><img src="{{img.src}}" alt="{{img.alt}}"></figure>',
    "  </header>",
    "",
    '  <nav class="toc">',
    '    <a href="{{toc1.href}}"><b>01</b>{{toc1.text}}</a>',
    '    <a href="{{toc2.href}}"><b>02</b>{{toc2.text}}</a>',
    '    <a href="{{toc3.href}}"><b>03</b>{{toc3.text}}</a>',
    '    <a href="{{toc4.href}}"><b>04</b>{{toc4.text}}</a>',
    "  </nav>",
    "",
    "  <main>",
    '    <section id="beans">',
    '      <span class="num">01</span>',
    "      <h2>{{beansTitle.text}}</h2>",
    "      <p>{{beansP.text}}</p>",
    '      <div class="cards">',
    '        <article class="card">',
    '          <span class="origin">埃塞俄比亚</span>',
    "          <h3>{{card1t.text}}</h3>",
    "          <p>{{card1b.text}}</p>",
    '          <span class="tag">水洗 · 浅烘</span>',
    "        </article>",
    '        <article class="card">',
    '          <span class="origin">哥伦比亚</span>',
    "          <h3>{{card2t.text}}</h3>",
    "          <p>{{card2b.text}}</p>",
    '          <span class="tag">水洗 · 中烘</span>',
    "        </article>",
    '        <article class="card">',
    '          <span class="origin">中国云南</span>',
    "          <h3>{{card3t.text}}</h3>",
    "          <p>{{card3b.text}}</p>",
    '          <span class="tag">日晒 · 中深烘</span>',
    "        </article>",
    "      </div>",
    "    </section>",
    "",
    '    <section id="roast">',
    '      <span class="num">02</span>',
    "      <h2>{{roastTitle.text}}</h2>",
    "      <p>{{roastP.text}}</p>",
    '      <div class="roast">',
    '        <div class="bar"></div>',
    '        <div class="labels">',
    "          <span>浅烘 — 明亮</span><span>中烘 — 平衡</span><span>深烘 — 醇厚</span>",
    "        </div>",
    "      </div>",
    "    </section>",
    "",
    '    <section id="grind">',
    '      <span class="num">03</span>',
    "      <h2>{{grindTitle.text}}</h2>",
    "      <p>{{grindP.text}}</p>",
    "      <p>手冲建议中细研磨，颗粒大约像细砂糖。喝到苦涩就调粗一格，淡而发酸就调细一格。</p>",
    "    </section>",
    "",
    '    <section id="brew">',
    '      <span class="num">04</span>',
    "      <h2>{{brewTitle.text}}</h2>",
    "      <p>水温越高，萃取越快。浅烘豆可以用 92–94 °C，深烘豆降到 88–90 °C 会更稳。</p>",
    '      <ol class="steps">',
    "        <li><b>温杯湿纸</b><span>用热水冲湿滤纸，去掉纸味，顺便温热分享壶。</span></li>",
    "        <li><b>闷蒸 30 秒</b><span>注入粉重两倍的水，让咖啡粉充分排气、均匀吸水。</span></li>",
    "        <li><b>分段注水</b><span>以画圈的方式慢慢注水，保持水位平稳，分两到三段完成。</span></li>",
    "        <li><b>2 分 30 秒完成</b><span>总时间控制在 2:30 左右，摇匀后就可以享用了。</span></li>",
    "      </ol>",
    '      <table id="params">',
    "        <thead>",
    "          <tr><th>参数</th><th>推荐</th><th>备注</th></tr>",
    "        </thead>",
    "        <tbody>",
    "          <tr><td>粉量</td><td>15 g</td><td>约一人份</td></tr>",
    "          <tr><td>水量</td><td>225 ml</td><td>粉水比 1 : 15</td></tr>",
    "          <tr><td>水温</td><td>92 °C</td><td>浅烘可提高到 94 °C</td></tr>",
    "          <tr><td>研磨</td><td>中细</td><td>类似细砂糖</td></tr>",
    "          <tr><td>时间</td><td>2:30</td><td>含 30 秒闷蒸</td></tr>",
    "        </tbody>",
    "      </table>",
    "      <blockquote>",
    "        好咖啡没有标准答案。记下每一次的参数和感受，下一杯就会更接近你喜欢的味道。",
    "        <cite>—— 写给下个周末的自己</cite>",
    "      </blockquote>",
    "    </section>",
    "  </main>",
    "",
    "  <footer>",
    '    <p>这份笔记用 HTML 写成，和其他笔记一起放在 Obsidian 库里。参考：<a href="{{footLink.href}}">{{footLink.text}}</a></p>',
    "  </footer>",
    "</body>",
    "</html>",
  ];

  const lineFor = {};
  sourceTemplate.forEach((line, index) => {
    const matcher = /\{\{(\w+)\.(\w+)\}\}/g;
    let match = matcher.exec(line);
    while (match) {
      if (!(match[1] in lineFor)) lineFor[match[1]] = index + 1;
      match = matcher.exec(line);
    }
  });

  const resourceLines = {
    cup: lineFor.img,
    favicon: sourceTemplate.findIndex((line) => line.includes("assets/favicon.png")) + 1,
    remote: lineFor.footLink,
    style: sourceTemplate.findIndex((line) => line.trim().startsWith("<style>")) + 1,
  };

  /* =========================================================================
     State
     ========================================================================= */
  let selected = null;
  let saveNotice = false;
  let zoom = 100;
  let searchQuery = "";
  let flashLine = null;
  let flashTimer = 0;
  let toastTimer = 0;
  let commitTimer = 0;
  let history = [{ values: clone(current) }];
  let historyIndex = 0;

  const lineForObject = (key) => lineFor[key] || 0;

  const objectElement = (key) =>
    page.querySelector(`[data-obj="${key}"]`);

  const getDisplayText = (key) => {
    const def = objectDefs[key];
    const value = current[key];
    if (!def || !value) return "";
    if (def.kind === "image") return value.alt;
    return value.text;
  };

  const isDirtyKey = (key) =>
    JSON.stringify(current[key]) !== JSON.stringify(saved[key]);

  const dirtyKeys = () =>
    Object.keys(objectDefs).filter((key) => isDirtyKey(key));

  /* =========================================================================
     Apply values to preview and source
     ========================================================================= */
  const applyObject = (key) => {
    const element = objectElement(key);
    const def = objectDefs[key];
    const value = current[key];
    if (!element || !def || !value) return;

    element.dataset.kind = def.kind;

    if (def.kind === "image") {
      const image = element.tagName === "IMG" ? element : element.querySelector("img");
      if (image) {
        image.setAttribute("src", value.src);
        image.setAttribute("alt", value.alt);
      }
      return;
    }

    const textTarget = element.querySelector("[data-text]") || element;
    textTarget.textContent = value.text;

    if (def.kind === "link") {
      element.setAttribute("href", value.href || "#");
    }
  };

  const applyAllObjects = () => {
    Object.keys(objectDefs).forEach(applyObject);
  };

  const buildSourceLines = () =>
    sourceTemplate.map((line) =>
      line.replace(/\{\{(\w+)\.(\w+)\}\}/g, (match, key, field) => {
        const value = current[key] ? current[key][field] : "";
        if (value === undefined || value === null) return "";
        return field === "text" ? escapeHTML(value) : escapeAttr(value);
      })
    );

  const highlightSourceLine = (line) => {
    let output = "";
    let cursor = 0;

    while (cursor < line.length) {
      const open = line.indexOf("<", cursor);
      if (open === -1) {
        output += `<span class="src-token">${escapeHTML(line.slice(cursor))}</span>`;
        break;
      }

      if (open > cursor) {
        output += `<span class="src-token">${escapeHTML(line.slice(cursor, open))}</span>`;
      }

      const close = line.indexOf(">", open);
      if (close === -1) {
        output += `<span class="src-tag">${escapeHTML(line.slice(open))}</span>`;
        break;
      }

      output += `<span class="src-tag">${escapeHTML(line.slice(open, close + 1))}</span>`;
      cursor = close + 1;
    }

    return output;
  };

  const renderSource = () => {
    const scrollTop = sourceScroll.scrollTop;
    const lines = buildSourceLines();

    sourceCode.innerHTML = lines
      .map((line, index) => {
        const number = index + 1;
        const key = Object.keys(lineFor).find((item) => lineFor[item] === number);
        const classes = ["src-line"];
        if (key) classes.push("is-clickable");
        if (key && key === selected) classes.push("is-selected");
        if (number === flashLine) classes.push("is-flash");

        return `<div class="${classes.join(" ")}" data-line="${number}"${
          key ? ` data-key="${key}"` : ""
        }><span class="src-num">${number}</span><span class="src-text">${highlightSourceLine(
          line
        )}</span></div>`;
      })
      .join("");

    sourceScroll.scrollTop = scrollTop;
  };

  /* =========================================================================
     Toast
     ========================================================================= */
  const toast = (message) => {
    if (!demoToast) return;
    demoToast.textContent = message;
    demoToast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      demoToast.classList.remove("is-visible");
    }, 2600);
  };

  /* =========================================================================
     Tabs
     ========================================================================= */
  const tabNameForPanel = (panel) => panel.id.replace("panel-", "");

  const openTab = (name) => {
    tabButtons.forEach((tab) => {
      const selectedTab = tab.id === `tab-${name}`;
      tab.setAttribute("aria-selected", String(selectedTab));
      tab.tabIndex = selectedTab ? 0 : -1;
    });

    tabPanels.forEach((panel) => {
      panel.hidden = tabNameForPanel(panel) !== name;
    });

    if (name === "outline") renderOutline();
    if (name === "changes") renderChanges();
  };

  tabButtons.forEach((tab) => {
    tab.addEventListener("click", () => openTab(tab.id.replace("tab-", "")));
  });

  const tablist = document.querySelector(".panel-tabs");
  if (tablist) {
    tablist.addEventListener("keydown", (event) => {
      const currentIndex = tabButtons.indexOf(document.activeElement);
      if (currentIndex < 0) return;

      let nextIndex = -1;

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = (currentIndex + 1) % tabButtons.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = tabButtons.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      const nextTab = tabButtons[nextIndex];
      openTab(nextTab.id.replace("tab-", ""));
      nextTab.focus();
    });
  }

  /* =========================================================================
     Edit form
     ========================================================================= */
  const updateEmptyCopy = () => {
    if (selected) return;
    const title = editEmpty.querySelector("strong");
    const text = editEmpty.querySelector("p");
    const hint = editEmpty.querySelector(".empty-hint");
    const previewMode = app.dataset.mode === "preview";

    if (!title || !text) return;

    if (previewMode) {
      title.textContent = "预览模式只读";
      text.textContent = "切到「编辑」，再点页面里的文字、链接或图片。";
      if (hint) hint.textContent = "预览不会运行页面脚本";
    } else {
      title.textContent = "在页面里点一段文字";
      text.textContent = "标题、正文、链接和图片都能改。选中后，这里会出现对应的表单。";
      if (hint) hint.textContent = "提示：也可以先切到「分栏」对照源码";
    }
  };

  const fieldIcon = (kind) => {
    if (kind === "link") return "i-link";
    if (kind === "image") return "i-image";
    return "i-type";
  };

  const renderEditPanel = () => {
    if (!selected) {
      editForm.hidden = true;
      editEmpty.hidden = false;
      editForm.innerHTML = "";
      updateEmptyCopy();
      return;
    }

    const def = objectDefs[selected];
    const value = current[selected];
    if (!def || !value) return;

    editEmpty.hidden = true;
    editForm.hidden = false;

    let fields = "";
    let kindWord = "文字片段";

    if (def.kind === "link") {
      kindWord = "链接属性";
      fields = `
        <div class="form-field">
          <label for="editLinkText">链接文字 <span>text</span></label>
          <input id="editLinkText" type="text" data-field="text" value="${escapeAttr(value.text)}" spellcheck="false">
        </div>
        <div class="form-field">
          <label for="editLinkHref">目标地址 <span>href</span></label>
          <input id="editLinkHref" type="text" data-field="href" value="${escapeAttr(value.href)}" spellcheck="false">
        </div>
      `;
    } else if (def.kind === "image") {
      kindWord = "图片属性";
      fields = `
        <div class="form-field">
          <label for="editImageSrc">图片地址 <span>只读</span></label>
          <input id="editImageSrc" type="text" value="${escapeAttr(value.src)}" readonly>
        </div>
        <div class="form-field">
          <label for="editImageAlt">替代文本 <span>alt</span></label>
          <input id="editImageAlt" type="text" data-field="alt" value="${escapeAttr(value.alt)}" spellcheck="false">
        </div>
        <button class="choose-image" type="button" data-action="pick-image">
          <svg class="icon" aria-hidden="true"><use href="#i-image"/></svg>
          选择库内图片…
        </button>
      `;
    } else {
      fields = `
        <div class="form-field">
          <label for="editText">文字内容 <span>${def.field}</span></label>
          <textarea id="editText" data-field="text" rows="${def.rows || 3}" spellcheck="false">${escapeHTML(
        value.text
      )}</textarea>
        </div>
      `;
    }

    const restoreDisabled = isDirtyKey(selected) ? "" : " disabled";

    editForm.innerHTML = `
      <div class="form-type">
        <span class="form-type-icon"><svg class="icon" aria-hidden="true"><use href="#${fieldIcon(
          def.kind
        )}"/></svg></span>
        <strong>${def.label}</strong>
        <span>${kindWord}</span>
      </div>
      ${fields}
      <p class="form-hint">修改即预览，保存后写入原文件。</p>
      <div class="form-actions">
        ${
          def.kind === "text"
            ? '<button class="mini-btn" type="button" data-action="paragraph"><svg class="icon" aria-hidden="true"><use href="#i-list"/></svg>整段编辑</button>'
            : ""
        }
        <button class="mini-btn is-quiet" type="button" data-action="restore"${restoreDisabled}>恢复此项</button>
      </div>
    `;
  };

  const syncRestoreButtons = () => {
    if (!selected) return;
    const restoreButton = editForm.querySelector('[data-action="restore"]');
    if (restoreButton) restoreButton.disabled = !isDirtyKey(selected);
  };

  const updateSelectionClasses = () => {
    page.querySelectorAll("[data-obj]").forEach((element) => {
      element.classList.toggle("is-selected", element.dataset.obj === selected);
    });
  };

  const selectObject = (key, options = {}) => {
    if (!objectDefs[key]) return;

    if (app.dataset.mode === "preview") {
      toast("切到编辑模式才能点选页面元素。");
      return;
    }

    selected = key;
    flashLine = null;
    window.clearTimeout(flashTimer);
    updateSelectionClasses();
    renderEditPanel();
    openTab("edit");
    renderSource();

    if (!options.fromSource && (app.dataset.mode === "source" || app.dataset.mode === "split")) {
      window.requestAnimationFrame(() => scrollSourceToLine(lineForObject(key)));
    }

    if (panelBody) panelBody.scrollTop = 0;
  };

  const clearSelection = () => {
    selected = null;
    page.querySelectorAll(".is-selected").forEach((element) => {
      element.classList.remove("is-selected");
    });
    renderEditPanel();
  };

  editForm.addEventListener("input", (event) => {
    const field = event.target.getAttribute("data-field");
    if (!selected || !field) return;

    const def = objectDefs[selected];
    const value = current[selected];
    if (!def || !value) return;

    if (def.kind === "text" && field === "text") {
      value.text = event.target.value;
    } else if (def.kind === "link" && (field === "text" || field === "href")) {
      value[field] = event.target.value;
    } else if (def.kind === "image" && field === "alt") {
      value.alt = event.target.value;
    } else {
      return;
    }

    saveNotice = false;
    applyObject(selected);
    renderSource();
    renderOutline();
    renderChanges();
    updateStatus();
    updateHistoryButtons();
    syncRestoreButtons();
    scheduleCommit();
  });

  editForm.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !selected) return;

    const action = button.getAttribute("data-action");
    if (action === "restore") {
      restoreKey(selected);
    } else if (action === "paragraph") {
      toast("原型演示片段编辑；真实插件可以切换到整段编辑。");
    } else if (action === "pick-image") {
      toast("原型没有接图片库；真实插件可以从库里选择图片。");
    }
  });

  const restoreKey = (key) => {
    if (!objectDefs[key]) return;
    flushCommit();
    current[key] = clone(saved[key]);
    saveNotice = false;
    applyObject(key);
    renderSource();
    renderOutline();
    renderChanges();
    updateStatus();
    updateHistoryButtons();
    if (selected === key) renderEditPanel();
    scheduleCommit();
    toast(`已恢复「${objectDefs[key].label}」的已保存内容`);
  };

  changesList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-restore]");
    if (!button) return;
    restoreKey(button.getAttribute("data-restore"));
  });

  /* =========================================================================
     Outline
     ========================================================================= */
  function renderOutline() {
    const query = searchQuery.trim().toLowerCase();
    const items = outlineDefs.map((item) => ({
      ...item,
      text: getDisplayText(item.key),
    }));
    const visible = query
      ? items.filter((item) => item.text.toLowerCase().includes(query))
      : items;

    outlineList.innerHTML = visible
      .map(
        (item) => `
        <li class="outline-item is-h${item.level}">
          <button type="button" data-outline-key="${item.key}">
            <span class="outline-mark">H${item.level}</span>
            <span class="outline-text">${escapeHTML(item.text)}</span>
          </button>
        </li>`
      )
      .join("");

    outlineEmpty.hidden = visible.length > 0;
    if (outlineCount) {
      outlineCount.textContent = query
        ? `${visible.length} / ${items.length} 项`
        : `${items.length} 项`;
    }

    if (searchCount) {
      searchCount.textContent = query ? `${visible.length} 项` : `${items.length} 项`;
      searchCount.classList.toggle("is-match", Boolean(query));
    }
    if (searchHint) {
      if (!query) {
        searchHint.textContent = "过滤大纲 · Enter 跳转";
      } else if (visible.length) {
        searchHint.textContent = `${visible.length} 项匹配 · Enter 跳转`;
      } else {
        searchHint.textContent = "没有匹配项，换个关键词";
      }
    }
  }

  outlineList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-outline-key]");
    if (!button) return;
    jumpToObject(button.getAttribute("data-outline-key"));
  });

  const flashElement = (element) => {
    element.classList.remove("is-flash");
    void element.offsetWidth;
    element.classList.add("is-flash");
    window.setTimeout(() => element.classList.remove("is-flash"), 1600);
  };

  const scrollPageTo = (element) => {
    const containerRect = pageScroll.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const target = pageScroll.scrollTop + (elementRect.top - containerRect.top) - 24;
    pageScroll.scrollTo({
      top: Math.max(0, target),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  function scrollSourceToLine(line) {
    if (!line) return;
    const lineElement = sourceCode.querySelector(`[data-line="${line}"]`);
    if (!lineElement) return;
    const containerRect = sourceScroll.getBoundingClientRect();
    const elementRect = lineElement.getBoundingClientRect();
    const target = sourceScroll.scrollTop + (elementRect.top - containerRect.top) - 90;
    sourceScroll.scrollTo({
      top: Math.max(0, target),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }

  const setFlashSourceLine = (line) => {
    window.clearTimeout(flashTimer);
    flashLine = line;
    renderSource();
    window.requestAnimationFrame(() => scrollSourceToLine(line));
    flashTimer = window.setTimeout(() => {
      flashLine = null;
      renderSource();
    }, 1900);
  };

  function jumpToObject(key) {
    const line = lineForObject(key);
    const sourceVisible = app.dataset.mode === "source" || app.dataset.mode === "split";

    if (app.dataset.mode !== "source") {
      const element = objectElement(key);
      if (element) {
        scrollPageTo(element);
        flashElement(element);
      }
    }

    if (sourceVisible) {
      setFlashSourceLine(line);
    }
  }

  /* =========================================================================
     Search
     ========================================================================= */
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    openTab("outline");
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && searchInput.value) {
      event.preventDefault();
      searchInput.value = "";
      searchQuery = "";
      renderOutline();
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();

    const first = outlineList.querySelector("button[data-outline-key]");
    if (first) {
      first.click();
    } else {
      toast("没有匹配项，换个关键词试试。");
    }
  });

  /* =========================================================================
     Changes
     ========================================================================= */
  function renderChanges() {
    const keys = dirtyKeys();
    if (changesCount) {
      changesCount.hidden = keys.length === 0;
      changesCount.textContent = String(keys.length);
    }
    if (changesSummary) {
      changesSummary.textContent = keys.length ? `${keys.length} 处` : "0 处";
    }

    changesList.innerHTML = "";
    changesEmpty.hidden = keys.length > 0;

    keys.forEach((key) => {
      const def = objectDefs[key];
      const value = current[key];
      const base = saved[key];
      const rows = [];

      if (def.kind === "image") {
        if (value.alt !== base.alt) {
          rows.push({ label: "替代文本", old: base.alt, next: value.alt });
        }
      } else if (def.kind === "link") {
        if (value.text !== base.text) {
          rows.push({ label: "链接文字", old: base.text, next: value.text });
        }
        if (value.href !== base.href) {
          rows.push({ label: "目标地址", old: base.href, next: value.href });
        }
      } else if (value.text !== base.text) {
        rows.push({ label: def.field, old: base.text, next: value.text });
      }

      if (!rows.length) return;

      const item = document.createElement("div");
      item.className = "change-item";
      item.innerHTML = `
        <div class="change-head">
          <span class="change-type">${def.label}</span>
          <strong>${escapeHTML(truncate(displayValue(getDisplayText(key)), 18))}</strong>
          <button type="button" data-restore="${key}">恢复</button>
        </div>
        ${rows
          .map(
            (row) => `
          <div class="change-old"><b>${row.label}</b><del>${escapeHTML(
              truncate(displayValue(row.old), 46)
            )}</del></div>
          <div class="change-new"><b>${row.label}</b><mark>${escapeHTML(
              truncate(displayValue(row.next), 46)
            )}</mark></div>`
          )
          .join("")}
      `;
      changesList.appendChild(item);
    });
  }

  /* =========================================================================
     Status, history, save
     ========================================================================= */
  function updateStatus() {
    const keys = dirtyKeys();
    const count = keys.length;
    const hasDirty = count > 0;

    if (dirtyDot) dirtyDot.classList.toggle("is-on", hasDirty);
    if (statusDot) statusDot.classList.toggle("is-dirty", hasDirty);

    if (dirtyStatus) {
      dirtyStatus.classList.toggle("is-saved", !hasDirty && saveNotice);
      dirtyStatus.textContent = hasDirty
        ? `${count} 处未保存`
        : saveNotice
        ? "已保存到 一杯好咖啡的诞生.html"
        : "无未保存更改";
    }

    if (changesCount) {
      changesCount.hidden = !hasDirty;
      changesCount.textContent = String(count);
    }
    if (changesSummary) {
      changesSummary.textContent = hasDirty ? `${count} 处` : "0 处";
    }

    syncRestoreButtons();
  }

  const currentSnapshot = () => clone(current);

  const updateHistoryButtons = () => {
    if (!undoBtn || !redoBtn) return;
    const pendingDifferent =
      JSON.stringify(current) !== JSON.stringify(history[historyIndex].values);
    undoBtn.disabled = historyIndex === 0 && !pendingDifferent;
    redoBtn.disabled = historyIndex >= history.length - 1 || pendingDifferent;
  };

  const commitSnapshot = () => {
    const snapshot = currentSnapshot();
    if (JSON.stringify(snapshot) === JSON.stringify(history[historyIndex].values)) {
      updateHistoryButtons();
      return;
    }
    history = history.slice(0, historyIndex + 1);
    history.push({ values: snapshot });
    historyIndex = history.length - 1;
    updateHistoryButtons();
  };

  function scheduleCommit() {
    window.clearTimeout(commitTimer);
    commitTimer = window.setTimeout(() => {
      commitTimer = 0;
      commitSnapshot();
    }, 480);
  }

  const flushCommit = () => {
    if (commitTimer) {
      window.clearTimeout(commitTimer);
      commitTimer = 0;
      commitSnapshot();
    }
  };

  const applyHistoryState = (values) => {
    Object.keys(objectDefs).forEach((key) => {
      current[key] = clone(values[key]);
      applyObject(key);
    });
    saveNotice = false;
    renderSource();
    renderOutline();
    renderChanges();
    renderEditPanel();
    updateStatus();
    updateHistoryButtons();
  };

  const undo = () => {
    flushCommit();
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    applyHistoryState(history[historyIndex].values);
    toast("已撤销上一组修改");
  };

  const redo = () => {
    flushCommit();
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    applyHistoryState(history[historyIndex].values);
    toast("已重做");
  };

  undoBtn?.addEventListener("click", undo);
  redoBtn?.addEventListener("click", redo);

  saveBtn?.addEventListener("click", () => {
    flushCommit();

    if (!dirtyKeys().length) {
      toast("没有需要保存的改动。");
      return;
    }

    Object.keys(objectDefs).forEach((key) => {
      saved[key] = clone(current[key]);
    });

    history = [{ values: currentSnapshot() }];
    historyIndex = 0;
    saveNotice = true;
    flashLine = null;

    renderSource();
    renderChanges();
    renderEditPanel();
    updateStatus();
    updateHistoryButtons();
    toast("已保存到 一杯好咖啡的诞生.html · 原型不会写入真实文件");
  });

  /* =========================================================================
     Mode switching
     ========================================================================= */
  const updatePreviewHint = () => {
    if (!previewHint) return;
    const mode = app.dataset.mode;
    if (mode === "preview") previewHint.textContent = "预览模式 · 只读";
    else if (mode === "edit") previewHint.textContent = "编辑模式 · 点击页面元素";
    else if (mode === "split") previewHint.textContent = "分栏 · 两边同步";
    else previewHint.textContent = "源码模式";
  };

  const setMode = (mode) => {
    if (!["preview", "edit", "source", "split"].includes(mode)) return;
    app.dataset.mode = mode;

    modeButtons.forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (mode === "preview") {
      clearSelection();
      renderSource();
    } else {
      renderEditPanel();
      if (mode === "source" || mode === "split") {
        renderSource();
        if (selected) {
          window.requestAnimationFrame(() => scrollSourceToLine(lineForObject(selected)));
        }
      }
    }

    updatePreviewHint();
    window.requestAnimationFrame(syncPageDensity);
  };

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  /* =========================================================================
     Toolbar, zoom, file tree
     ========================================================================= */
  document.querySelectorAll(".panel-tools [data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const label = button.getAttribute("data-tool");

      if (label === "收起文件树" || label === "展开文件树") {
        const hidden = app.classList.toggle("tree-hidden");
        button.setAttribute("data-tool", hidden ? "展开文件树" : "收起文件树");
        button.setAttribute("aria-label", hidden ? "展开文件树" : "收起文件树");
        toast(hidden ? "文件树已收起" : "文件树已展开");
        return;
      }

      if (label === "刷新预览") {
        renderSource();
        toast("预览已刷新（原型不会重新读取文件）");
        return;
      }

      if (label === "后退" || label === "前进") {
        toast("原型只有这一页；真实插件会记住每页的滚动位置。");
        return;
      }

      if (label === "更多菜单") {
        toast("更多菜单：草稿管理器、另存为、复制嵌入（原型）");
        return;
      }

      toast(`${label}（原型）`);
    });
  });

  const setZoom = (next) => {
    zoom = Math.max(60, Math.min(140, next));
    page.style.zoom = String(zoom / 100);
    if (zoomLabel) zoomLabel.textContent = `${zoom}%`;
  };

  zoomInBtn?.addEventListener("click", () => setZoom(zoom + 10));
  zoomOutBtn?.addEventListener("click", () => setZoom(zoom - 10));
  zoomLabel?.addEventListener("click", () => {
    setZoom(100);
    toast("预览缩放已重置为 100%");
  });

  document.querySelectorAll("[data-tree-file]").forEach((button) => {
    button.addEventListener("click", () => {
      toast(`原型只载入了一份页面。「${button.getAttribute("data-tree-file")}」在真实插件里会直接打开。`);
    });
  });

  document.querySelector(".tree-file.is-current")?.addEventListener("click", () => {
    toast("已经在编辑这一页了。");
  });

  /* =========================================================================
     Page selection
     ========================================================================= */
  page.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const editable = target.closest("[data-obj]");
      const staticBlock = target.closest("[data-static-hint]");

      event.preventDefault();

      if (app.dataset.mode === "preview") {
        toast("切到编辑模式才能点选页面元素。");
        return;
      }

      if (editable) {
        selectObject(editable.getAttribute("data-obj"));
        return;
      }

      if (staticBlock) {
        toast("这一段内容在原型里没有开放编辑；真实插件可用源码模式修改。");
        return;
      }

      toast("这一段不在可视化编辑范围内，切到源码看看。");
    },
    true
  );

  /* =========================================================================
     Source interaction and resources
     ========================================================================= */
  sourceCode.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const line = target.closest("[data-key]");
    if (!line) return;
    selectObject(line.getAttribute("data-key"), { fromSource: true });
  });

  document.querySelectorAll("[data-res]").forEach((button) => {
    button.addEventListener("click", () => {
      const resource = button.getAttribute("data-res");
      const line = resourceLines[resource];
      if (!line) return;

      setMode("source");
      setFlashSourceLine(line);

      const names = {
        cup: "本地图片",
        favicon: "缺失图片",
        remote: "远程链接",
        style: "内联样式",
      };
      toast(`已定位到${names[resource] || "资源"}的源码行（原型）`);
    });
  });

  /* =========================================================================
     Initialize
     ========================================================================= */
  const syncPageDensity = () => {
    page.classList.toggle("is-compact", pageScroll.clientWidth < 560);
  };

  if ("ResizeObserver" in window) {
    const densityObserver = new ResizeObserver(syncPageDensity);
    densityObserver.observe(pageScroll);
  } else {
    window.addEventListener("resize", syncPageDensity, { passive: true });
  }

  applyAllObjects();
  syncPageDensity();
  renderSource();
  renderOutline();
  renderChanges();
  renderEditPanel();
  updateStatus();
  updateHistoryButtons();
  updatePreviewHint();
  setZoom(100);
  openTab("edit");
})();
