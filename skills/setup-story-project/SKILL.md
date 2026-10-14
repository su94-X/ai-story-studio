---
name: setup-story-project
description: 为本机Codex初始化AI影视创作室的创作项目、专职story-keeper及story-reviewer Agent、MCP配置和恢复Hooks。用于首次启用持续创作、为新项目建立档案或明确要求接入本地能力；只配置用户选定工作区，不修改全局Codex设置。
---

# 初始化创作项目

确认用户选定工作区和创作项目目录；已提供就继承，不重复询问。创作目录放在插件源码和安装目录之外。用户尚未指定时可在当前工作区下新建 `创作项目/<项目代号>`，简短说明实际路径。

本插件需要 Node.js 20+。使用宿主已有 shell 检查真实路径；Windows 使用 PowerShell 7。无需 API Key、向量数据库或外部记忆服务。

从本 SKILL.md 所在目录向上定位插件根目录，运行其中的 `scripts/setup-project.mjs`：

```text
node <插件根目录>/scripts/setup-project.mjs --workspace <工作区绝对路径> --project-root <创作目录绝对路径> --project-id <稳定代号> --title <标题>
```

按 shell 规则分别引用路径参数。脚本写项目级 `.codex/agents/story-keeper.toml` 和 `.codex/agents/story-reviewer.toml`、`.codex/config.toml` 中的 MCP 和 Hooks 托管区，以及活动项目入口；已有不同角色配置会停止，已有项目配置修改前会备份，不覆盖用户其他配置。

完成后告知具体创建位置。在该工作区开启新的 Codex 会话，确认工作区受信任，核对 `ai_story_studio` 工具和 `story-keeper`、`story-reviewer` 是否出现。Hooks 必须按宿主提示审阅并信任；不要伪称脚本写入配置就已经加载或获信任，也不要替用户绕过信任审阅。

本机配置的 MCP 与已安装插件中的同名服务可能同时出现。选用实际连接并验证的一个，避免重复提交；不自动修改全局插件设置。项目级配置是可独立验证的入口，插件打包也包含 MCP 配置。

用 studio_open_project 核对 ID，读取空状态。只有真正开始创作后才由主创和 story-keeper 建立记录；不要把模板示例写成用户事实。

已有项目升级时可再次运行相同初始化命令，新增审稿角色并保留现有数据与配置；不同的同名自定义角色会停止供比较。写后审查由主创 Agent 执行 Skill 流程，不是后台文件监听。
