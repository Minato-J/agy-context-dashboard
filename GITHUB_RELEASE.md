# AGY Context Dashboard v0.9.7

`wycocoyu/agy-context-dashboard` `v0.9.7`（MIT 协议）新增**非侵入式更新提醒**：有新版本时自动亮绿点与版本徽标，不打断对话、不再需要手动打开检查更新，同时在 IDE Trusted Types 下修复 GitHub 仓库图标渲染（[`#32`](https://github.com/wycocoyu/agy-context-dashboard/issues/32)）。

## 更新内容

- **非侵入更新提醒（[`#32`](https://github.com/wycocoyu/agy-context-dashboard/issues/32)）**：后台静默检查新版本（启动时 + 每 `6` 小时，与手动检查互斥去重）；有新版本时，内嵌栏上下文胶囊右上角亮绿点（纯图标模式依旧可见）并在悬停提示中附带目标版本号；详情弹窗的「检查更新」旁显示绿色 `v{最新版}` 徽标，已是最新时自动隐藏，完整保留手动「重新检查」与「更新」按钮。
- **更新说明排版升级**：发布说明以圆点列表呈现，中英文混排按字宽智能截断，附「完整说明 ↗」跳转 GitHub Release。
- **GitHub 仓库图标修复**：页脚仓库链接 SVG 强制 `stroke: none`，在 IDE Trusted Types 环境下正常渲染。

## 安装或更新

- **Antigravity 桌面 App**：上下文详情 → **检查更新**（`v0.8.14+`），或解压 `antigrative-dashboard-0.9.7.zip` 后运行 `python3 manage.py install`（Windows 用 `python`）。
- **Antigravity CLI / 独立 IDE**：CLI 运行 `python3 manage.py install-cli`；IDE 安装 `antigrative-dashboard-ide-0.9.7.vsix`。现有配置与统计自动保留。

---

## What changed in v0.9.7

- **Non-intrusive update badges ([`#32`](https://github.com/wycocoyu/agy-context-dashboard/issues/32)):** Passive release checks (boot + every `6h`, deduped with manual checks) light a green dot on the inline context chip (visible in icons-only mode) with the target version in the tooltip, and a green `v{latest}` badge beside **Check for updates** in the dialog — hidden automatically when already current, with manual **Re-check** and **Update** actions preserved.
- **Release notes rendering:** Bulleted notes with CJK-aware clipping and a "Full notes ↗" link to the GitHub release.
- **Trusted Types-safe repo SVG:** Force `stroke: none` on the footer GitHub mark so it renders inside the IDE.

## Install or update

- **Antigravity App:** Open context details → **Check for updates** (`v0.8.14+`), or extract `antigrative-dashboard-0.9.7.zip` and run `python3 manage.py install` (`python` on Windows).
- **Antigravity CLI / Standalone IDE:** Run `python3 manage.py install-cli` for CLI `statusLine`, or install `antigrative-dashboard-ide-0.9.7.vsix` via **Install from VSIX…**. Settings, history, and SHA-256 verification remain intact.
