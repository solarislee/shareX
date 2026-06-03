# Context

最后更新：2026-06-03

## 项目概况

当前目录是 `shareX`，一个 Chrome MV3 扩展项目。

扩展名称：

- 中文：推文转图卡
- 英文：Post to Image Card

核心用途：

- 在 `x.com` / `twitter.com` 的帖子操作栏注入一个生成图片按钮。
- 读取用户当前查看的单条帖子的公开内容，包括正文、作者昵称/头像、配图和日期。
- 支持普通图片和视频推文：视频会优先截取页面中 `video` 的当前帧，失败时回退到 X 页面里的视频封面图。
- 用 Canvas 在浏览器本地渲染成一张图片卡片。
- 支持下载 PNG 或复制到剪贴板。

隐私立场：

- 不收集、不存储、不上传、不分享用户数据。
- 不使用广告、分析、追踪或远程加载代码。
- 配图通过 background service worker 从 `twimg.com` 抓取，仅用于本地绘制到 Canvas。

## 关键文件

- `manifest.json`：Chrome MV3 配置，当前版本 `1.0.0`。
- `content.js`：注入按钮、提取帖子内容、Canvas 渲染、预览弹窗。
- `content.css`：按钮和弹窗样式。
- `background.js`：后台抓取图片并转成 data URL，避免 Canvas 跨域污染。
- `popup.html`：工具栏弹窗说明。
- `README.md`：本地安装和使用说明。
- `STORE_LISTING.md`：Chrome Web Store 提交文案和权限说明。
- `PRIVACY.md`：中英文隐私政策。
- `post-to-image-card.zip`：打包产物。
- `store-assets/`：商店素材目录。

## Chrome Web Store 发布资料

`STORE_LISTING.md` 已整理：

- 名称 / Name
- 简短摘要 / Summary
- 详细描述 / Detailed description
- 分类：工具 / Productivity
- 单一用途说明
- 权限用途说明
- 数据使用声明
- 隐私政策 URL：`https://solarislee.github.io/shareX/privacy.html`

仍需手动准备：

- 至少 1 张截图：`1280x800` 或 `640x400`
- 可选小宣传图：`440x280`

## 权限和声明

当前 `manifest.json` 权限：

- `clipboardWrite`
- `host_permissions`
  - `https://x.com/*`
  - `https://twitter.com/*`
  - `https://*.twimg.com/*`

提交 Chrome Web Store 时的说明重点：

- `clipboardWrite`：用于把生成图片复制到剪贴板。
- `x.com` / `twitter.com`：用于注入按钮和读取当前帖子公开内容。
- `*.twimg.com`：用于抓取帖子配图并在本地绘制。
- 不使用 remote code。
- 数据使用声明选择 does not collect。

## Trader / Non-Trader 判断

Chrome Web Store 或 marketplace 表单里的区别：

- `trader account`：发布者是以商业、职业、业务、副业等专业目的参与 marketplace。
- `non-trader account`：发布者是个人兴趣、实验或非商业目的参与 marketplace。

我们的判断：

- 如果这个账号未来明确要用来商业化、收费、持续运营、作为副业或业务赚钱，选 `trader account` 更稳。
- 如果当前只是免费试水、没有明确商业化计划，`non-trader account` 更符合个人非商业状态。
- 一旦开始收费、持续运营或以赚钱为目的发布，通常应改成 `trader account`。

当前倾向：

- 用户表示“未来想赚钱”，所以如果这个账号就是准备承载未来商业化，建议直接按 `trader account` 处理，避免后续合规、付款、消费者保护或下架风险。

## 工具状态

已执行：

```bash
brew upgrade --cask codex
```

结果：

- `codex` 已从 `0.135.0` 升级到 `0.136.0`。
- Homebrew 已清理旧版本 `0.135.0` 文件。

## 后续建议

1. 准备 Chrome Web Store 截图素材。
2. 核对 `post-to-image-card.zip` 是否包含发布所需文件且不包含多余文件。
3. 在 Chrome Web Store 填写 `STORE_LISTING.md` 中的内容。
4. 数据使用声明按“不收集数据”填写。
5. 如果决定未来商业化，发布者身份优先选 `trader account`。

## 2026-06-03 视频推文修复

用户反馈这个视频推文没有分享出视频画面：

`https://x.com/HeyAbhishek/status/2058573486084567110`

已修改 `content.js`：

- 增加 `extractMediaImages()`，除 `tweetPhoto` 外，也会收集 `pbs.twimg.com/media` 和 `pbs.twimg.com/ext_tw_video_thumb` 里的媒体图/视频封面。
- 增加 `captureVideoFrame()` / `extractVideoFrames()`，点击生成时尝试把页面里的 `video` 当前帧绘制到临时 Canvas 并转成 data URL。
- `extract()` 改为 async，媒体列表会把视频帧放在图片前面。
- 如果视频帧截图成功，会移除 `ext_tw_video_thumb` 视频封面，避免同一个视频同时出现“当前帧 + 封面”两张图。
- `tryLoad()` 支持直接加载 data URL，不再只走后台 fetch。
- `handleCapture()` 已改为 `await extract(article)`。
- 媒体布局已改为按源图片/视频帧自身宽高比显示；单图、多图和视频都不再拉伸变形，也不再把多图强制裁成固定 3:2。
- 特别高的媒体会限制最大显示高度并等比缩小宽度居中，仍保持原始比例。

验证：

- `node --check content.js` 通过。
- `node --check background.js` 通过。
- 已用 `zip -r post-to-image-card.zip content.js` 更新现有 Chrome Web Store 上传包中的 `content.js`。
