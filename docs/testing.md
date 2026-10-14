# 验证范围

## 自动化检查

`npm test` 覆盖项目身份、自由结构记录、原子批次、并发冲突、原稿短引、CRLF、历史快照、证据失效、必回收项、定稿、重新修订、检查点、路径边界、初始化、stdio MCP 和 ZIP。

其中三次 PreCompact/SessionStart 循环是**事件输入模拟**：每次创建新的 Store 实例，核对最新约束、检查点和快照。它证明事件处理与磁盘恢复逻辑，不能单独证明宿主已自动调用 Hooks。

`npm run check` 校验五个 Skill 的 frontmatter、引用、共享交接资源、派生清单和图标；skill-creator 的 quick_validate 提供额外技能格式检查。格式通过不代表真实写作判断通过。

`scripts/sdk-smoke.py` 使用官方 MCP Python SDK 检查协议协商、工具列表、初始化和恢复调用。插件运行时不需要 Python 或该 SDK。

当前本机结果为32项 Node 测试通过；运行环境为 Windows、Node.js 24.16.0。`docs/ci-validation.yml` 提供 Windows/Linux 与 Node.js 20/22 的 GitHub Actions 模板。需要启用时将其复制到 `.github/workflows/ci.yml`，并使用具有 workflow 权限的 GitHub 凭据。本次发布没有运行该矩阵，不将模板算作跨平台验证结果。

## 行为与宿主验证

发布前另做独立 Agent 的短片及连续短剧试用，检查实际正文、守护分工、证据与定稿回执。模型生成的预计时长仍需朗读、表演或剪辑校准。

本机 Codex 验证应分别记录：配置是否读取、MCP 是否连接、专职角色是否实际被调用、压缩是否实际发生、Hooks 是否受信任并运行、恢复后的约束是否来自最新档案。未得到这些运行证据时逐项保留限制，不能把状态文件、示例或模型自述当成已验证事实。

记录本次发布的实际结果见 release 的说明；真实创作项目和完整调试日志不进入发布 ZIP。
