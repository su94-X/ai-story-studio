# MCP 工具与项目档案

所有操作显式提供用户选定项目的绝对路径 `project_root`。运行服务时可用 `--workspace ABS` 限定项目范围。原稿只读取项目内 UTF-8 的 `.md`、`.txt` 和 `.json` 文件，单个不超过5 MiB。原稿 hash 基于原始字节，读取文字统一为 LF 便于跨平台定位。

| 工具 | 行为 |
|---|---|
| studio_read_guidance | 只读获取守护 Skill 与固定参考入口，支持关闭 shell 的角色 |
| studio_open_project | 创建或打开稳定项目 ID |
| studio_read_state | 按类型、ID 或版本读取状态 |
| studio_register_document | 登记原稿并保留文字快照，不改原稿 |
| studio_read_document | 读当前或历史原稿的指定行 |
| studio_make_anchor | 根据实际短引生成版本与场次定位 |
| studio_put_records | 批量原子更新 Agent 提交的自由结构记录 |
| studio_audit | 查证据、原稿版本和未回收必需项 |
| studio_submit_review | 保存当前版本的 Agent 语义审查 |
| studio_save_checkpoint | 保存 Agent 编写的摘要、上下文和下一步 |
| studio_recover_project | 返回最新档案、索引、原稿与检查点状态 |
| studio_list_versions | 列出历史及可能未完成提交的版本 |
| studio_compare_versions | 返回版本变化，由 Agent 判断其影响 |
| studio_finalize_project | 通过闭环和当前语义审查后定稿 |
| studio_reopen_project | 按用户请求开启新修订，保留历史 |

`thread` 记录使用稳定 ID、promise、required、status、plant_refs 和 payoff_refs。状态区分计划、埋设、发展、回收、取消和延期。取消/延期必回收项及降低 required 需要用户决定记录；禁止改变旧 ID 的类型来隐藏伏笔。

`studio_read_document` 未指定 `document_hash` 时读取工作稿，`sourceKind=working-copy`；指定 hash 时读取保存的快照，`sourceKind=snapshot`。`path` 始终对应返回文字的实际来源，`registeredPath` 是当前登记的工作稿路径，`registeredCurrent` 只表示返回 hash 是否等于最新登记 hash。历史稿不会被标注为新版工作稿。

记录 data 可扩展，Agent 可定义新 type。其他原稿索引可以使用 data.refs 保存证据定位。工具验证短引和版本；它不能判断短引是否真的兑现伏笔，也无法代替用户原话的来源判断，因此需独立语义审查。

写入使用 expected_revision，冲突时先读新版本再合并。状态通过临时文件和原子替换保存；提交前保存版本快照，崩溃可能留下 prepared 版本。出现遗留 write.lock 或 prepared 版本时保留文件，检查活动进程并比较历史，不自动删锁或覆盖恢复。

需要从不支持 live MCP 的环境诊断时，可用 `node scripts/tool-call.mjs TOOL ARGUMENTS.json` 调用 stdio 工具。应如实称为 CLI 传输调用，不能说工具已绑定到当前聊天。它会启动一次服务、调用并退出，档案仍保存在项目文件。
