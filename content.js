/* X 推文转图片 — content script
 * 在每条推文操作栏注入按钮，点击后抽取内容并用 Canvas 渲染成分享卡片。
 */
(() => {
  "use strict";

  const BTN_CLASS = "x2img-btn";

  /* ---------------------------------------------------------------------- */
  /* 1. 在每条推文里注入「转图片」按钮                                        */
  /* ---------------------------------------------------------------------- */

  function addButtons() {
    document
      .querySelectorAll('article[data-testid="tweet"]')
      .forEach((article) => {
        if (article.querySelector("." + BTN_CLASS)) return;
        const group = article.querySelector('[role="group"]');
        if (!group) return;

        const btn = document.createElement("div");
        btn.className = BTN_CLASS;
        btn.title = "转成图片分享";
        btn.setAttribute("role", "button");
        btn.textContent = "📸";
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleCapture(article, btn);
        });
        group.appendChild(btn);
      });
  }

  let addTimer = null;
  function scheduleAdd() {
    clearTimeout(addTimer);
    addTimer = setTimeout(addButtons, 250);
  }

  new MutationObserver(scheduleAdd).observe(document.body, {
    childList: true,
    subtree: true,
  });
  addButtons();

  /* ---------------------------------------------------------------------- */
  /* 2. 抽取推文内容                                                          */
  /* ---------------------------------------------------------------------- */

  // 块级标签：article 长文正文是多段 <p>/<div>，段落间要补换行
  const BLOCK_TAGS = new Set([
    "P", "DIV", "LI", "UL", "OL", "BLOCKQUOTE", "FIGURE", "SECTION",
    "H1", "H2", "H3", "H4", "H5", "H6",
  ]);

  // 递归取文本，保留 emoji（X 用 <img alt="😀">）和换行
  function extractText(el) {
    let out = "";
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent;
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        if (n.tagName === "IMG") out += n.getAttribute("alt") || "";
        else if (n.tagName === "BR") out += "\n";
        else {
          const block = BLOCK_TAGS.has(n.tagName);
          if (block && out && !out.endsWith("\n")) out += "\n";
          out += extractText(n);
          if (block && out && !out.endsWith("\n")) out += "\n";
        }
      }
    });
    return out;
  }

  // 收尾清理：去掉块级换行造成的多余空行
  function cleanText(s) {
    return s.replace(/\n{3,}/g, "\n\n").trim();
  }

  function extract(article) {
    let name = "";
    let handle = "";
    const nameEl = article.querySelector('[data-testid="User-Name"]');
    if (nameEl) {
      const link = nameEl.querySelector("a");
      if (link) name = link.innerText.trim().split("\n")[0];
      nameEl.querySelectorAll("span").forEach((s) => {
        const tx = s.innerText.trim();
        if (tx.startsWith("@") && !handle) handle = tx;
      });
    }

    // 普通推文正文
    const textEl = article.querySelector('[data-testid="tweetText"]');
    let title = "";
    let text = textEl ? cleanText(extractText(textEl)) : "";

    // X Article（长文）：正文不在 tweetText 里
    if (!text) {
      const titleEl = article.querySelector(
        '[data-testid="twitter-article-title"]'
      );
      if (titleEl) title = titleEl.innerText.trim();
      const bodyEl = article.querySelector(
        '[data-testid="longformRichTextComponent"], [data-testid="twitterArticleRichTextView"]'
      );
      if (bodyEl) text = cleanText(extractText(bodyEl));
    }

    const avatarImg = article.querySelector(
      '[data-testid="Tweet-User-Avatar"] img, img[src*="profile_images"]'
    );
    const avatar = avatarImg ? avatarImg.src : "";

    // 配图：普通推文用 tweetPhoto；article 用正文里的媒体图（排除 emoji）
    let images = [
      ...article.querySelectorAll('[data-testid="tweetPhoto"] img'),
    ].map((i) => i.src);
    if (!images.length) {
      const bodyEl = article.querySelector(
        '[data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]'
      );
      if (bodyEl) {
        images = [...bodyEl.querySelectorAll("img")]
          .map((i) => i.src)
          .filter((s) => s.includes("pbs.twimg.com/media"));
      }
    }

    const timeEl = article.querySelector("time");
    const datetime = timeEl ? timeEl.getAttribute("datetime") : "";

    return { name, handle, title, text, avatar, images, datetime };
  }

  // 把缩略图 URL 换成高清版
  function hq(url) {
    if (!url) return url;
    if (url.includes("pbs.twimg.com/media") || url.includes("name=")) {
      return url
        .replace(/([?&])name=\w+/, "$1name=large")
        .replace(/&name=\w+/, "&name=large");
    }
    return url
      .replace("_normal.", "_400x400.")
      .replace("_bigger.", "_400x400.")
      .replace("_mini.", "_400x400.");
  }

  /* ---------------------------------------------------------------------- */
  /* 3. 抓图片 + 加载成 Image                                                 */
  /* ---------------------------------------------------------------------- */

  function fetchImageDataUrl(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "fetchImage", url }, (resp) => {
        if (chrome.runtime.lastError)
          return reject(new Error(chrome.runtime.lastError.message));
        if (resp && resp.ok) resolve(resp.dataUrl);
        else reject(new Error((resp && resp.error) || "fetch failed"));
      });
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function tryLoad(url) {
    try {
      return await loadImage(await fetchImageDataUrl(hq(url)));
    } catch (_) {
      try {
        return await loadImage(await fetchImageDataUrl(url));
      } catch (_) {
        return null;
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 4. Canvas 渲染卡片                                                       */
  /* ---------------------------------------------------------------------- */

  const SCALE = 2; // 高分辨率输出
  const CARD_W = 600; // 卡片宽度(CSS px)
  const MARGIN = 22; // 卡片外留白
  const PAD = 32; // 卡片内边距

  const FONT =
    '-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

  function fontStr(size, weight) {
    return (weight ? weight + " " : "") + size + "px " + FONT;
  }

  const isCJK = (c) =>
    /[⺀-鿿豈-﫿＀-￯　-〿぀-ヿ]/.test(c);

  function tokenize(text) {
    const tokens = [];
    let buf = "";
    for (const ch of text) {
      if (ch === " ") {
        if (buf) {
          tokens.push(buf);
          buf = "";
        }
        tokens.push(" ");
      } else if (isCJK(ch)) {
        if (buf) {
          tokens.push(buf);
          buf = "";
        }
        tokens.push(ch);
      } else {
        buf += ch;
      }
    }
    if (buf) tokens.push(buf);
    return tokens;
  }

  function wrap(ctx, text, maxW) {
    const lines = [];
    text.split("\n").forEach((para) => {
      if (para === "") {
        lines.push("");
        return;
      }
      let line = "";
      const tokens = tokenize(para);
      for (let token of tokens) {
        // 单个 token 本身就超宽（超长 URL 等），按字符硬断
        if (ctx.measureText(token).width > maxW) {
          for (const ch of token) {
            if (ctx.measureText(line + ch).width > maxW && line) {
              lines.push(line);
              line = "";
            }
            line += ch;
          }
          continue;
        }
        if (ctx.measureText(line + token).width > maxW && line.trim()) {
          lines.push(line);
          line = token === " " ? "" : token;
        } else {
          line += token;
        }
      }
      lines.push(line);
    });
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  // 计算多图布局，返回 {rects:[{x,y,w,h,img}], height}
  function layoutImages(imgs, x, y, maxW) {
    const gap = 8;
    const rects = [];
    if (imgs.length === 0) return { rects, height: 0 };

    if (imgs.length === 1) {
      const im = imgs[0];
      const ratio = im.naturalHeight / im.naturalWidth;
      const w = maxW;
      const h = Math.min(maxW * ratio, 460);
      rects.push({ x, y, w, h, img: im });
      return { rects, height: h };
    }

    const cols = 2;
    const cellW = (maxW - gap) / cols;
    const cellH = cellW * 0.66; // 多图统一裁切成 3:2
    const rows = Math.ceil(imgs.length / cols);
    imgs.forEach((im, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      rects.push({
        x: x + c * (cellW + gap),
        y: y + r * (cellH + gap),
        w: cellW,
        h: cellH,
        img: im,
        crop: true,
      });
    });
    return { rects, height: rows * cellH + (rows - 1) * gap };
  }

  function drawImageCropped(ctx, im, x, y, w, h) {
    const sr = im.naturalWidth / im.naturalHeight;
    const dr = w / h;
    let sx, sy, sw, sh;
    if (sr > dr) {
      sh = im.naturalHeight;
      sw = sh * dr;
      sx = (im.naturalWidth - sw) / 2;
      sy = 0;
    } else {
      sw = im.naturalWidth;
      sh = sw / dr;
      sx = 0;
      sy = (im.naturalHeight - sh) / 2;
    }
    ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h);
  }

  async function renderCard(data) {
    // 预加载图片
    const avatarImg = data.avatar ? await tryLoad(data.avatar) : null;
    const mediaImgs = [];
    for (const u of data.images.slice(0, 4)) {
      const im = await tryLoad(u);
      if (im) mediaImgs.push(im);
    }

    // 用临时 ctx 量文字
    const measure = document.createElement("canvas").getContext("2d");
    const contentW = CARD_W - PAD * 2;

    // 标题（article 长文才有）
    const titleLineH = 32;
    measure.font = fontStr(23, "700");
    const titleLines = data.title ? wrap(measure, data.title, contentW) : [];

    // 正文 + 限高截断
    const MAX_BODY_LINES = 80;
    measure.font = fontStr(18.5);
    let textLines = data.text ? wrap(measure, data.text, contentW) : [];
    const lineH = 28;
    let truncated = false;
    if (textLines.length > MAX_BODY_LINES) {
      textLines = textLines.slice(0, MAX_BODY_LINES);
      truncated = true;
    }

    // 头部高度
    const headerH = 56;
    let cardH = PAD + headerH + 16;
    if (titleLines.length) cardH += titleLines.length * titleLineH + 14;
    if (textLines.length) cardH += textLines.length * lineH + 12;
    if (truncated) cardH += lineH;

    const imgLayout = layoutImages(
      mediaImgs,
      0,
      0,
      contentW
    );
    if (mediaImgs.length) cardH += imgLayout.height + 16;
    cardH += 8 + 24 + PAD; // 分隔 + footer + 底padding

    const totalW = CARD_W + MARGIN * 2;
    const totalH = cardH + MARGIN * 2;

    const canvas = document.createElement("canvas");
    canvas.width = totalW * SCALE;
    canvas.height = totalH * SCALE;
    const ctx = canvas.getContext("2d");
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = "alphabetic";

    // 背景渐变
    const bg = ctx.createLinearGradient(0, 0, totalW, totalH);
    bg.addColorStop(0, "#eef2ff");
    bg.addColorStop(1, "#e7f0fb");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, totalW, totalH);

    // 卡片阴影 + 白底
    ctx.save();
    ctx.shadowColor = "rgba(15,23,42,0.18)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    roundRect(ctx, MARGIN, MARGIN, CARD_W, cardH, 24);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();

    const ox = MARGIN + PAD;
    let cy = MARGIN + PAD;

    // 头像
    const avSize = 48;
    if (avatarImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ox + avSize / 2, cy + avSize / 2, avSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatarImg, ox, cy, avSize, avSize);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(ox + avSize / 2, cy + avSize / 2, avSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#cbd5e1";
      ctx.fill();
    }

    // 名字 + handle
    const tx = ox + avSize + 14;
    ctx.fillStyle = "#0f172a";
    ctx.font = fontStr(17, "600");
    ctx.fillText(data.name || "", tx, cy + 19);
    ctx.fillStyle = "#64748b";
    ctx.font = fontStr(15);
    ctx.fillText(data.handle || "", tx, cy + 41);

    // 右上角小图标（蓝色圆点，避免使用第三方商标 logo）
    ctx.beginPath();
    ctx.arc(MARGIN + CARD_W - PAD - 8, cy + 22, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#1d9bf0";
    ctx.fill();

    cy += headerH + 16;

    // 标题
    if (titleLines.length) {
      ctx.fillStyle = "#0f172a";
      ctx.font = fontStr(23, "700");
      titleLines.forEach((ln) => {
        ctx.fillText(ln, ox, cy + 23);
        cy += titleLineH;
      });
      cy += 14;
    }

    // 正文
    if (textLines.length) {
      ctx.fillStyle = "#0f172a";
      ctx.font = fontStr(18.5);
      textLines.forEach((ln) => {
        ctx.fillText(ln, ox, cy + 20);
        cy += lineH;
      });
      if (truncated) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = fontStr(15);
        ctx.fillText("…… 全文过长已截断，请查看原文", ox, cy + 18);
        cy += lineH;
      }
      cy += 12;
    }

    // 图片
    if (mediaImgs.length) {
      const lay = layoutImages(mediaImgs, ox, cy, contentW);
      lay.rects.forEach((rc) => {
        ctx.save();
        roundRect(ctx, rc.x, rc.y, rc.w, rc.h, 14);
        ctx.clip();
        if (rc.crop) drawImageCropped(ctx, rc.img, rc.x, rc.y, rc.w, rc.h);
        else ctx.drawImage(rc.img, rc.x, rc.y, rc.w, rc.h);
        ctx.restore();
        ctx.save();
        roundRect(ctx, rc.x, rc.y, rc.w, rc.h, 14);
        ctx.strokeStyle = "rgba(15,23,42,0.06)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      });
      cy += lay.height + 16;
    }

    // 分隔线
    ctx.strokeStyle = "#eef2f6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox, cy);
    ctx.lineTo(ox + contentW, cy);
    ctx.stroke();
    cy += 22;

    // footer
    ctx.fillStyle = "#94a3b8";
    ctx.font = fontStr(13.5);
    ctx.fillText(formatDate(data.datetime), ox, cy);
    ctx.textAlign = "right";
    ctx.fillText("由「推文转图卡」生成", ox + contentW, cy);
    ctx.textAlign = "left";

    return canvas;
  }

  /* ---------------------------------------------------------------------- */
  /* 5. 弹窗预览 + 下载 + 复制                                                */
  /* ---------------------------------------------------------------------- */

  function showModal(canvas) {
    closeModal();
    const overlay = document.createElement("div");
    overlay.className = "x2img-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    const box = document.createElement("div");
    box.className = "x2img-box";

    const preview = document.createElement("img");
    preview.className = "x2img-preview";
    canvas.toBlob((blob) => {
      preview.src = URL.createObjectURL(blob);
    });

    const bar = document.createElement("div");
    bar.className = "x2img-bar";

    const dlBtn = mkBtn("⬇️ 下载图片", "primary", () => {
      canvas.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "tweet-" + Date.now() + ".png";
        a.click();
      });
    });

    const copyBtn = mkBtn("📋 复制到剪贴板", "", async () => {
      try {
        await new Promise((res, rej) =>
          canvas.toBlob((blob) => {
            navigator.clipboard
              .write([new ClipboardItem({ "image/png": blob })])
              .then(res, rej);
          })
        );
        copyBtn.textContent = "✅ 已复制";
        setTimeout(() => (copyBtn.textContent = "📋 复制到剪贴板"), 1500);
      } catch (e) {
        copyBtn.textContent = "❌ 复制失败，请用下载";
      }
    });

    const closeBtn = mkBtn("关闭", "ghost", closeModal);

    bar.append(dlBtn, copyBtn, closeBtn);
    box.append(preview, bar);
    overlay.append(box);
    document.body.append(overlay);

    document.addEventListener("keydown", escClose);
  }

  function mkBtn(label, variant, onClick) {
    const b = document.createElement("button");
    b.className = "x2img-action" + (variant ? " " + variant : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function escClose(e) {
    if (e.key === "Escape") closeModal();
  }

  function closeModal() {
    const ov = document.querySelector(".x2img-overlay");
    if (ov) ov.remove();
    document.removeEventListener("keydown", escClose);
  }

  /* ---------------------------------------------------------------------- */
  /* 6. 主流程                                                                */
  /* ---------------------------------------------------------------------- */

  async function handleCapture(article, btn) {
    const old = btn.textContent;
    btn.textContent = "⏳";
    btn.style.pointerEvents = "none";
    try {
      const data = extract(article);
      const canvas = await renderCard(data);
      showModal(canvas);
    } catch (e) {
      console.error("[X推文转图片] 渲染失败", e);
      alert("生成图片失败：" + e.message);
    } finally {
      btn.textContent = old;
      btn.style.pointerEvents = "";
    }
  }
})();
