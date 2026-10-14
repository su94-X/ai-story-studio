# AI Story Studio · AI影视创作室

面向本机 Codex 的中文 AI 短片与连续短剧创作插件。通过 **主创 Agent + 伏笔与记忆 Agent + Skill + 本地 MCP** 完成选材、开发、文学剧本、修订和项目恢复。MIT 开源。

Agent 决定如何理解故事、设计伏笔和保留创作状态。MCP 只提供可靠的原稿、证据、版本和档案工具。项目保存在可读文件中，无向量数据库、传统 RAG、外部记忆服务或单独的模型 API Key。运行时零 npm 依赖，需要 **Node.js 20+**。

## 能力

- 中文热点研究：实际联网、来源与时间核验、事件去重、不同叙事视角、故事与制作双轴比较。使用 Codex 已提供的搜索/网页工具，不能把公开检索等同于完整平台热榜。
- 文学剧本：独立短片、连续短剧、人物关系、类型结构、对白潜台词、分集、续写及修订。交付终点为完整文学剧本。
- 专职 `story-keeper`：只维护档案和审查正文，由主创修改剧本。关注伏笔、人物知情、规则、时间线、修订影响和未完成范围。
- 证据闭环：伏笔状态必须关联真实原文和版本；原稿改变使旧证据过期。必回收项未完成时不能定稿。
- 恢复：阶段检查点、版本历史、原稿快照、压缩前持久化状态快照及压缩/恢复后的项目入口。

## 最小开始流程

先下载 [Releases](https://github.com/su94-X/ai-story-studio/releases) 的 ZIP 并解压，或克隆源码：

```powershell
git clone https://github.com/su94-X/ai-story-studio.git
cd ai-story-studio
node --version
```

选择一个已存在的工作区；创作项目放在插件源码之外。Windows 使用 PowerShell 7，例如：

```powershell
node scripts/setup-project.mjs --workspace "D:\我的创作" --project-root "D:\我的创作\项目\雨夜钥匙" --project-id "rain-key" --title "雨夜钥匙"
```

这会建立项目级 `.codex/agents/story-keeper.toml`、MCP 与 Hooks 配置、活动项目入口及空档案。只修改选定工作区；已有配置先备份，其他设置保留。再次运行同样命令不会重复添加配置。已有不同的同名角色或 MCP 配置会停止并保留原文件。

在该工作区开启新 Codex 会话，先确认工作区受信任，再核对 `ai_story_studio` 工具和 `story-keeper`，并按宿主提示审阅和信任 Hooks。未信任工作区时，项目级配置可能不会加载。初始化写入文件不等于宿主已加载或已信任。

首次未安装插件时，可以直接让 Codex 读取解压目录中的 `skills/story-studio/SKILL.md`。安装为插件可使用本地/仓库 marketplace；CLI 0.157.1 使用：

```powershell
codex plugin marketplace add su94-X/ai-story-studio
codex plugin add ai-story-studio@ai-story-studio-personal
```

不同客户端的命令与本地插件入口可能变化，以 `codex plugin --help` 和插件目录界面为准。安装后仍需为工作区初始化专职角色。若插件和项目配置同时提供同名 MCP，只使用核对后连接成功的一个。

## 五个 Skill

| Skill | 入口 |
|---|---|
| `$story-studio` | 整体项目、选材后写作、持续创作与恢复 |
| `$select-story` | 热点、原创或已有素材选材 |
| `$write-screenplay` | 新写、改编、续写与修订文学剧本 |
| `$keep-story-memory` | 伏笔、连续性、索引和恢复检查 |
| `$setup-story-project` | 初始化本地项目能力 |

示例请求：“搜索近7天中文话题，比较5个适合3分钟短片的选题。” “开发6集、每集90秒的短剧，完成全部正文，并让 story-keeper 核对必回收伏笔。” “恢复雨夜钥匙项目，先核对最新原稿与人物知情范围，再续写。”

## 记忆如何保持

用户项目的 `.story-studio/` 包含最新档案、历史版本、原稿快照、检查点和压缩前快照。每条记录使用稳定 ID，`data` 可扩展；Agent 可以新增类型，不局限于固定人物表格。

主创写正文 → 登记原稿 → 守护 Agent 读取并维护证据 → 返回修订意见 → 主创改正文 → 守护复核。终稿需要当前语义审查和结构证据都通过。专职 Agent 被压缩或重建时也从项目文件恢复，不依靠自己的聊天永久存活。

Hooks 只通知恢复并保存已经持久化的状态，不会读取模型未输出的想法。正常创作需要在场次/单集或阶段完成时更新档案。结构检查通过不能证明故事质量、估算时长或所有生成能力已经验证。

## 开发与验证

```powershell
npm test
npm run check
npm run build
```

无需 `npm install`。Release ZIP 和 SHA-256 位于 `dist/`。ZIP 使用明确的文件白名单，不包含个人创作档案、Git 元数据或本机配置。

可选的官方 MCP SDK 互通检查：安装开发依赖 `mcp==1.29.1` 后运行 `python -X utf8 scripts/sdk-smoke.py`。这是额外验证，不是运行插件的依赖。

详细说明：[架构](docs/architecture.md)、[工具与档案](docs/mcp-tools.md)、[验证范围](docs/testing.md)、[版本记录](CHANGELOG.md)。示例创作数据仅用于演示，不是热点或真实事件。

## 隐私与兼容

默认项目档案留在本机，并被仓库 `.gitignore` 排除。把私人创作项目与公开插件源码分开放置。插件不会上传项目、创建后台提醒或调用付费生成。

原有 v1 项目开发卡可由 Agent 读取并转换，保留原件。新的运行时档案格式为2，和可读项目卡的版本分别记录。现有 `select-story` / `write-screenplay` 入口保留。

Codex 支持范围参考 [官方 Agent 文档](https://learn.chatgpt.com/docs/agent-configuration/subagents)、[Hooks 文档](https://learn.chatgpt.com/docs/hooks) 和 [插件打包规范](https://developers.openai.com/plugins/build/plugins)。带 Hooks 的本地插件与公共插件目录的提交规则不同；本仓库通过 GitHub 开源分发。
