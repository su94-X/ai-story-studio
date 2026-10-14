# 可选结构助手

`scripts/review_structure.py` 只使用 Python 标准库，无网络、无上传、无生成请求。用于已提供兼容 project.json 或审查者从明确事实建立的视图。不解析任意自然语言剧本，不替代人工语义审查。

Windows 使用 PowerShell 7。常用调用：

```powershell
python '<skill目录>/scripts/review_structure.py' '<项目>/review-view.json'
python '<skill目录>/scripts/review_structure.py' '<项目>/review-view.json' --caps-file '<项目>/review-caps.json' --check-files
```

JSON 输出到标准输出；返回码0表示未发现结构阻断（可能仍有待验证事项），1表示发现结构阻断，2表示输入无法读取/解析。不会修改输入，也不代表平台接受或质量通过。

## 审查视图

保留实际存在的字段，缺失保持缺失。`shots` 的 start/end 是组内秒数；连续对白若有逐句时间，也用组内秒数。`duration=-1` 保留为平台自适应请求，另提供 `planned_duration` 才能核算计划。

```json
{
  "review_schema": 1,
  "speech_notation": {"OS": "INNER"},
  "require_voice_references": false,
  "characters": {"C01": {"name": "角色甲"}},
  "assets": {"I01": {"kind": "image", "path": "assets/角色甲.png"}},
  "segments": [{
    "id": "G01",
    "source_location": "第1场，镜1-2",
    "duration": 12,
    "images": [{"asset": "I01"}],
    "voices": [],
    "videos": [],
    "handoff": {"continuity": "cut"},
    "shots": [{
      "start": 0, "end": 12,
      "utterances": [{
        "id": "U01", "character": "C01", "kind": "D", "text": "你回来了。",
        "start": 2, "end": 4
      }]
    }]
  }]
}
```

`characters`/`assets` 缺失时引用保持待验证；已提供完整映射时未登记ID为明确错误。旁白可使用专门登记的声音身份。`require_voice_references=true` 只用于项目明确要求每句绑定外部音色的情况；默认不要求。

助手核对段ID与全片逐句ID、时间顺序/重叠/覆盖缺口、引用、已声明连续边界、明确提供的caps，以及可选文件存在性。对白重叠仅提醒审查是否为有意同时发声，不自动当错误。跨镜延续一句可只在起始镜登记，并设 `spans_shots=true`，时间仍须在组内；跨组拆句另保留源句和子句来源。它不推算语速，也不判断动作、表演或嘴型。

已知本次渠道/模型/模式时可提供顶层 `production` 对象，字段为 `provider`、`model`、`mode`。与能力证据不匹配时助手跳过该证据的上限检查，标记待核对；别名对应关系仍需审查者以真实项目说明确认。

## 能力证据输入

没有 `--caps-file` 时不猜平台上限，报告能力未验证。该文件是审查用的明确能力证据，不是API配置。针对本次模型、渠道、模式核对后填写；不能从不同版本随便挑更宽的数值。

```json
{
  "provider": "火山方舟原生接口",
  "model": "本次实际模型ID",
  "mode": "multimodal_reference",
  "checked_on": "2026-10-08",
  "source": "本次核对的官方文档或公开能力记录位置",
  "limits": {
    "duration_min": 4,
    "duration_max": 30,
    "max_images": 30,
    "max_audios": 10,
    "max_videos": 10,
    "max_audio_seconds": 30,
    "max_video_seconds": 30
  }
}
```

这是2.5全模态快照数值的示例，`model`/`source`须填真实依据才能传给助手。项目更低的有效上限也放入 limits，并在 source 标记来源。可加 `max_prompt_chars`，只计段中的 `compiled_prompt`，用 Python Unicode `len()`；缺最终稿时保持待验证，不拿作者稿冒充。其他平台的字符计数单位不同就另行核算。

引用音/视频的 `assets` 可带已测 `duration`，助手累加已引用素材；缺时长不按0计，标记待验证。`--check-files` 仅验证本地路径指向文件，不访问远程URL、不解码、不核对画面或声线。
