# 档案与证据约定

项目原稿位于用户创作目录。`.story-studio/state.json` 是最新档案，`versions/` 是不可覆盖的修订历史，`documents/` 保存登记原稿的文字快照，`checkpoint.json` 是 Agent 编写的恢复入口。所有写入保留在项目目录，不写全局 Codex 记忆。

记录形状为 `{id, type, data}`。ID 稳定，不随排序改变；data 可包含新字段。建议类型：constraint、character、world_rule、decision、thread、source、index、progress。它们是定位约定，除 thread 的生命周期与证据规则外，不要求固定人物表格。

区分用户决定、原稿事实、暂定计划、创作推断。有效决定发生变化时保留被替代内容和依据；不要只覆盖一个简短摘要，丢掉原稿定位。

## 原稿与证据

主创保存正文后调用 `studio_register_document`。守护者通过 `studio_read_document` 阅读，调用 `studio_make_anchor` 获得 document_id、document_hash、scene_id、行号和短引。

多集建议分别登记，例如 EP01、EP02。场次 ID 由项目保持稳定。原文有修改时 hash 变化；旧证据会过期，守护者重读相关场次再重新定位，不自动把旧结论沿用到新稿。

其他记录可使用 `data.refs` 保存证据定位。用户条件可保存用户原话和来源说明；没有原稿依据的推断注明暂定，不伪造短引。

## thread 记录

```json
{
  "id": "F001",
  "type": "thread",
  "data": {
    "promise": "红线绳结的方向将揭示钥匙被调换",
    "required": true,
    "status": "planned",
    "plant_refs": [],
    "payoff_refs": [],
    "planned_payoff": "第3集的主动试验",
    "meaning": "主角从被动怀疑转为自己验证"
  }
}
```

状态为 planned、planted、developing、paid_off、cancelled、deferred。已埋设和发展中需要 plant_refs；已回收同时需要 plant_refs 和 payoff_refs。工具只核对原文和版本，戏剧作用由 Agent 判断。

必回收项取消或延期须关联 decision_id：该 decision 的 data.origin 为 user，并有实际用户原话 quote。不能为通过终稿审查自动改 required=false。确有用户改动时记录影响和原因。

## 写入和终稿

每次更新带 expected_revision。不同 Agent 共享项目，不共享一份可以随意覆盖的聊天摘要。MCP 版本冲突返回最新 revision，重新读取后合并。

`studio_submit_review` 使当前版本得到审查记录；此后任何原稿登记或索引变更都会让审查失效。`studio_finalize_project` 要求已登记 screenplay、结构通过、必回收项闭环和最新 pass。它不检测作品是否优秀，不能替代守护 Agent 的正文审查。

定稿仍保留历史。用户要求修改时主创调用 `studio_reopen_project` 并注明依据，再按新版本审查。
