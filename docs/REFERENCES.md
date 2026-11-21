# 竞品与参考项目

同赛道（Antigravity 上下文 / 额度 / 用量监控与界面增强）可参考的项目跟踪。发现新项目直接往本章补一节，commit 即版本。README 开头那句「参考 DSH 设计」指的就是下方 DSH 生态一节。

## 一览

| 项目 | 形态 | 与本项目关系 |
| --- | --- | --- |
| [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) | DSH（DeepSeek Harness）插件（npm / Cordis） | **设计灵感来源**（不同宿主，无竞争） |
| [ATtacK030130/antigrative-dashboard](https://github.com/ATtacK030130/antigrative-dashboard) | Python 管理器 + Node sidecar + 内联 widget | **同构竞品 / 活跃上游**，定期互同步 |
| [elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer) | `app.asar` 注入补丁 + CLI | 异构竞品（功能重叠度最高） |
| [n2ns/antigravity-panel](https://github.com/n2ns/antigravity-panel) | VS Code / Open VSX 扩展 | IDE 侧竞品（不覆盖桌面 App 内嵌） |
| [nkjDSLcvanv/antigravity-codex-theme](https://github.com/nkjDSLcvanv/antigravity-codex-theme) | CDP 运行时注入（主题 / 汉化 / 轻统计） | 参考项目（同款注入路线的工程实践） |
| [Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch) | CDP 运行时注入（美化 / 字体 / 汉化） | 参考项目（上表 codex-theme 的参考来源） |

## 分项笔记

### DSH 生态：bowenliang123/dsh-context

DSH = **DeepSeek Harness**（DeepSeek 的 agent harness，npm 包 `@deepseek-ai/dsh`）。`dsh-context` 是其「上下文洞察」插件（5.4k stars，Apache-2.0，DSH 团队成员公开推荐），即 README「参考 DSH 设计」的对象。五个入口覆盖上下文全生命周期：

- **上下文洞察页**：跨会话总览——Token / 成本 / 缓存命中率 KPI、7 天用量图、活动热力图、技能 / 工具 / 命令统计；
- **Context 标签页**：单会话完整仪表板——六色堆叠的上下文组成、逐请求趋势（Delta 模式）、上下文浏览器（含 DNA 模式）、事件日志、文件活动；
- **Fleet 标签页**：父 / 子 Agent 实时卡片与协作泳道时间线（多 Agent 协作透视，我们尚无对应物）;
- **`/context` 命令**：聊天中直接弹出当前组成与浏览器；
- 数据读 DSH 官方 Token 投影（`contextPressure` / `contextBreakdown`），成本按 models.dev 价格表估算，缓存只存轻量摘要。

宿主不同（DSH vs Antigravity），无竞争关系；把它当作上下文信息架构与多 Agent 透视设计的对照组。

### ATtacK030130/antigrative-dashboard

紧凑型 Token 吞吐与配额监控 widget，形态与我们几乎一致（`manage.py install` + Node sidecar + 回环调试端口内联挂载，不动 `app.asar`，本地采集）。三端适配（桌面 ZIP / IDE VSIX / CLI statusLine）。`v0.9.6` 起我们持续同步其上下文 UI 与探测加固改动（如 `v0.9.9`–`v0.9.10` 的压缩徽标、租约保活、报错脱敏）。最新 `v0.9.11` 修复 `2.34.0+` 额度 / TPS 采集并把 Neon 模型映射进 Gemini 配额组——**同步上游时优先看它的 release notes**。

### elviscjn-cjn/antigravity-context-viewer

ASAR 注入式看板：主进程钩子 + 预加载桥接 + 渲染层面板，自研 ASAR 打包引擎，零依赖。功能面最宽：按模型配置上下文长度（含社区「上下文解锁」，注意服务端不一定接受）、顶栏额度圆环（剩余 + 5h/周 + 重置时间）、生成速度、52 周活跃热力图、API 费用估算、汉化、免 TUN 代理。与我们「不篡改 `app.asar`」的红线相反，升级即失效；主要在 Windows 验证。**可对比它的额度圆环与重置时间展示、历史热力图交互**。

### n2ns/antigravity-panel

TypeScript VS Code 扩展（仅 IDE 侧，读本地 Language Server）：配额监控（状态栏随剩余变黄变红）、用量趋势 + 剩余额度可用时长预测（runway，14 天历史）、上下文占用 80% 压缩预警、Brain / Code Tracker 缓存浏览与清理、Auto-Accept、本地 LLM 生成 AI commit。871 stars，同赛道里社区声量最大。**可借鉴 runway 预测的呈现与缓存清理能力**；不与桌面 App 内嵌正面冲突。

### nkjDSLcvanv/antigravity-codex-theme

CDP 实时注入的 Codex 风格主题 + 1,900 条汉化 + 轻量会话统计，与本项目同款「不动 `app.asar`、回环调试端口注入」路线。工程化程度高：27 模块守护进程、`--only` 按需组合、`user/` 层改配置约 2.5s 热重载、27 项单测 + CI、`2.30.x–2.34.0+` 含调试端口冷启动接力。**注入工程（冷启动接力、热重载、模块拆分）值得对照**。

### Anarcadia/chuanban-antigravity-theme-patch

上表 codex-theme 的参考来源：CDP 注入美化补丁，`core/` 只读内核 + `user/` 可定制层分离，零 npm 依赖。多套昼夜配色预设、Google Sans Flex + 更纱黑体四层中西文排版、约 1,940 条隔离式汉化、`node:sqlite` 实时 Token 胶囊（tok/s、TTFT、缓存命中率）、零侵入启动接力与 Windows 保活自愈。**分层架构与排版 / 汉化词条工程可参考**。

## 维护说明

- 新发现的项目补进「一览」表并在下方加小节；项目改名 / 归档 / 路线变化时更新对应行。
- 关注点记录「能抄什么 / 要防什么」，不写主观评分。
- 涉及同步上游代码的（目前仅 ATtacK030130 一支）照常走 CHANGELOG + commit 留痕。
