#!/usr/bin/env python3
"""Read-only structural audit; no API calls and no semantic quality verdict."""

import argparse
import json
import math
import sys
from datetime import date
from pathlib import Path

EPSILON = 0.001
KINDS = {"D", "OFF", "INNER", "VO"}
LIMIT_KEYS = {
    "duration_min", "duration_max", "max_images", "max_audios", "max_videos",
    "max_audio_seconds", "max_video_seconds", "max_prompt_chars",
}


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"JSON contains a duplicate object key: {key}")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f"JSON contains a non-finite number: {value}")


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"),
                      object_pairs_hook=unique_object, parse_constant=reject_constant)


def validate_caps(caps):
    if not isinstance(caps, dict):
        raise ValueError("Capability evidence must be an object")
    for field in ("provider", "model", "mode", "checked_on", "source"):
        if not nonempty(caps.get(field)):
            raise ValueError(f"Capability evidence requires {field}")
    date.fromisoformat(caps["checked_on"])
    limits = caps.get("limits")
    if not isinstance(limits, dict):
        raise ValueError("Capability evidence requires a limits object")
    for key, value in limits.items():
        if key in LIMIT_KEYS and (not number(value) or value < 0):
            raise ValueError(f"Invalid capability limit: {key}")
        if key in {"max_images", "max_audios", "max_videos", "max_prompt_chars"}:
            if int(value) != value:
                raise ValueError(f"Count/character limit must be an integer: {key}")
    if limits.get("duration_min", 0) > limits.get("duration_max", math.inf):
        raise ValueError("Capability duration_min exceeds duration_max")
    return limits


def audit(document, base_dir, caps=None, check_files=False):
    issues = []
    totals = []

    def add(code, severity, location, message):
        issues.append({"code": code, "severity": severity, "location": location, "message": message})

    def mapping(key):
        value = document.get(key)
        if value is None and key not in document:
            add("REGISTRY_UNPROVIDED", "pending", f"$.{key}", "未提供登记表，引用保持待核对。")
            return None
        if not isinstance(value, dict):
            add("REGISTRY_TYPE", "blocking", f"$.{key}", "登记表必须是对象。")
            return None
        return value

    def interval(item, location, ceiling):
        start, end = item.get("start"), item.get("end")
        if not number(start) or not number(end) or start < 0 or end <= start:
            add("TIME_INTERVAL", "blocking", location, "时间必须为有限数字，且0≤start<end。")
            return None
        if ceiling is not None and end > ceiling + EPSILON:
            add("TIME_OVERFLOW", "blocking", location, "时间区间超出所属计划范围。")
        return start, end

    if not isinstance(document, dict):
        raise ValueError("Input must be a project/review-view JSON object")
    characters = mapping("characters")
    assets = mapping("assets")
    notation = document.get("speech_notation", {})
    if not isinstance(notation, dict) or any(value not in KINDS for value in notation.values() if isinstance(value, str)):
        add("NOTATION_TYPE", "blocking", "$.speech_notation", "声音映射必须指向D/OFF/INNER/VO。")
        notation = {}
    elif any(not isinstance(value, str) for value in notation.values()):
        add("NOTATION_TYPE", "blocking", "$.speech_notation", "声音映射的值必须是字符串。")
        notation = {}
    require_voice = document.get("require_voice_references", False)
    if not isinstance(require_voice, bool):
        add("VOICE_POLICY_TYPE", "blocking", "$.require_voice_references", "必须为布尔值。")
        require_voice = False
    limits = validate_caps(caps) if caps is not None else {}
    if caps is None:
        add("CAPS_UNVERIFIED", "pending", "$", "未提供对应渠道/模型/模式的能力证据，不检查平台上限。")
    else:
        scope = document.get("production")
        if scope is not None:
            if not isinstance(scope, dict):
                add("PRODUCTION_TYPE", "blocking", "$.production", "制作范围必须是对象。")
                limits = {}
            elif any(scope.get(key) not in (None, caps[key]) for key in ("provider", "model", "mode")):
                add("CAPS_SCOPE_MISMATCH", "pending", "$.production", "能力证据与制作范围不匹配，未应用其上限。")
                limits = {}
        unknown_limits = sorted(set(limits) - LIMIT_KEYS)
        if unknown_limits:
            add("LIMITS_UNCHECKED", "pending", "$caps.limits", "未实现的能力字段：" + ", ".join(unknown_limits))

    checked_files = set()

    def reference(asset_id, expected_kind, location):
        if not nonempty(asset_id):
            add("ASSET_ID", "blocking", location, "素材引用需要非空asset ID。")
            return None
        if assets is None:
            return None
        if asset_id not in assets:
            add("ASSET_UNREGISTERED", "blocking", location, "引用的素材ID未登记。")
            return None
        asset = assets[asset_id]
        if not isinstance(asset, dict):
            add("ASSET_TYPE", "blocking", location, "素材登记必须是对象。")
            return None
        if asset.get("kind") != expected_kind:
            add("ASSET_KIND", "blocking", location, "素材种类与引用职责不匹配。")
        if check_files and asset_id not in checked_files:
            checked_files.add(asset_id)
            local_path = asset.get("path")
            if not nonempty(local_path) or "://" in local_path:
                add("FILE_UNVERIFIED", "pending", f"$.assets[{asset_id!r}].path", "没有可核对的本地路径，不访问远程素材。")
            else:
                candidate = Path(local_path)
                if not candidate.is_absolute():
                    candidate = Path(base_dir) / candidate
                try:
                    exists = candidate.is_file()
                except (OSError, ValueError):
                    exists = False
                if not exists:
                    add("FILE_MISSING", "blocking", f"$.assets[{asset_id!r}].path", "登记路径没有对应本地文件。")
        return asset

    segments = document.get("segments")
    if not isinstance(segments, list) or not segments:
        add("SEGMENTS_REQUIRED", "blocking", "$.segments", "需要非空segments数组；其他生产schema请先阅读，不直接套本解析器。")
        segments = []
    seen_segments, seen_utterances = set(), set()
    previous_segment = None
    for index, segment in enumerate(segments):
        loc = f"$.segments[{index}]"
        if not isinstance(segment, dict):
            add("SEGMENT_TYPE", "blocking", loc, "生成组必须是对象。")
            previous_segment = None
            continue
        sid = segment.get("id")
        if not nonempty(sid):
            add("SEGMENT_ID", "blocking", loc + ".id", "组ID必须为非空字符串。")
        elif sid in seen_segments:
            add("SEGMENT_DUPLICATE", "blocking", loc + ".id", "组ID重复。")
        else:
            seen_segments.add(sid)
        requested = segment.get("duration")
        adaptive = number(requested) and requested == -1
        duration = segment.get("planned_duration") if adaptive else requested
        if adaptive:
            add("ADAPTIVE_DURATION", "pending", loc + ".duration", "自适应请求不保证满足计划时长，需生成后复核。")
        if duration is None and (adaptive or "duration" not in segment):
            add("DURATION_UNPROVIDED", "pending", loc, "缺计划时长，无法核算完整覆盖和总预算。")
            duration = None
        elif not number(duration) or duration <= 0:
            add("DURATION_INVALID", "blocking", loc, "计划时长必须为正的有限数字。")
            duration = None
        totals.append(duration)
        if duration is not None:
            if duration < limits.get("duration_min", 0) - EPSILON or duration > limits.get("duration_max", math.inf) + EPSILON:
                add("DURATION_CAP", "blocking", loc + ".duration", "生成计划超出所提供能力证据的有效时长范围。")

        voice_characters = set()
        for key, kind, count_key, time_key in (
            ("images", "image", "max_images", None),
            ("voices", "audio", "max_audios", "max_audio_seconds"),
            ("videos", "video", "max_videos", "max_video_seconds"),
        ):
            entries = segment.get(key, [])
            if not isinstance(entries, list):
                add("REFERENCE_LIST", "blocking", loc + "." + key, "有序参考必须是数组。")
                continue
            if len(entries) > limits.get(count_key, math.inf):
                add("REFERENCE_COUNT", "blocking", loc + "." + key, "参考数量超过所提供能力证据的上限。")
            known_time, unknown_time = 0, False
            for entry_index, entry in enumerate(entries):
                entry_loc = f"{loc}.{key}[{entry_index}]"
                if not isinstance(entry, dict):
                    add("REFERENCE_TYPE", "blocking", entry_loc, "参考条目必须是含asset的对象。")
                    unknown_time = True
                    continue
                asset = reference(entry.get("asset"), kind, entry_loc)
                if key == "voices":
                    cid = entry.get("character")
                    if not nonempty(cid):
                        add("VOICE_CHARACTER", "blocking", entry_loc, "音色参考需要声音身份。")
                    else:
                        voice_characters.add(cid)
                        if characters is not None and cid not in characters:
                            add("CHARACTER_UNREGISTERED", "blocking", entry_loc, "声音身份未登记。")
                if time_key:
                    length = asset.get("duration") if asset else None
                    if number(length) and length > 0:
                        known_time += length
                    else:
                        unknown_time = True
            if time_key and time_key in limits:
                if known_time > limits[time_key] + EPSILON:
                    add("REFERENCE_TIME_CAP", "blocking", loc + "." + key, "已知参考时长合计已经超过上限。")
                if entries and unknown_time:
                    add("REFERENCE_TIME_UNVERIFIED", "pending", loc + "." + key, "部分参考时长未提供，不按零计。")

        handoff = segment.get("handoff", {})
        if not isinstance(handoff, dict):
            add("HANDOFF_TYPE", "blocking", loc + ".handoff", "边界记录必须是对象。")
            handoff = {}
        continuity = segment.get("continuity", handoff.get("continuity"))
        if "continuity" in segment and "continuity" in handoff and segment["continuity"] != handoff["continuity"]:
            add("CONTINUITY_CONFLICT", "blocking", loc, "同组两处连续关系定义冲突。")
        if continuity is not None and continuity not in ("continuous", "cut"):
            add("CONTINUITY_KIND", "blocking", loc, "连续关系需为continuous或cut。")
        if continuity == "continuous" and index > 0:
            prev_handoff = previous_segment.get("handoff", {}) if previous_segment else {}
            prev_out = prev_handoff.get("out") if isinstance(prev_handoff, dict) else None
            this_in = handoff.get("in")
            if prev_out is None or this_in is None:
                add("HANDOFF_UNVERIFIED", "pending", loc + ".handoff", "声明连续但未提供双方共享边界目标；实际连续性仍需观察。")
            elif not nonempty(prev_out) or not nonempty(this_in) or prev_out != this_in:
                add("HANDOFF_MISMATCH", "blocking", loc + ".handoff", "声明共享边界，但前段out与本段in不一致。")
        for boundary in ("in", "out"):
            if boundary in handoff:
                reference(handoff[boundary], "image", loc + ".handoff." + boundary)

        prompt = segment.get("compiled_prompt")
        if prompt is not None and not isinstance(prompt, str):
            add("PROMPT_TYPE", "blocking", loc + ".compiled_prompt", "最终提示词必须是字符串。")
        elif "max_prompt_chars" in limits:
            if prompt is None:
                add("PROMPT_UNPROVIDED", "pending", loc, "未提供最终编译稿，不拿作者稿代替。")
            elif len(prompt) > limits["max_prompt_chars"]:
                add("PROMPT_CAP", "blocking", loc + ".compiled_prompt", "最终编译稿Unicode字符数超过已提供上限。")

        shots = segment.get("shots")
        if shots is None:
            add("SHOTS_UNPROVIDED", "pending", loc, "未提供内部镜头，未检查镜头时间或对白。")
            shots = []
        elif not isinstance(shots, list) or not shots:
            add("SHOTS_TYPE", "blocking", loc + ".shots", "shots需要非空数组。")
            shots = []
        cursor, utterance_intervals = 0, []
        for shot_index, shot in enumerate(shots):
            shot_loc = f"{loc}.shots[{shot_index}]"
            if not isinstance(shot, dict):
                add("SHOT_TYPE", "blocking", shot_loc, "镜头必须是对象。")
                continue
            shot_span = interval(shot, shot_loc, duration)
            if shot_span:
                start, end = shot_span
                if start < cursor - EPSILON:
                    add("SHOT_OVERLAP", "blocking", shot_loc, "内部顺序镜头重叠或乱序；蒙太奇并行关系应另行说明。")
                elif start > cursor + EPSILON:
                    add("SHOT_GAP", "review", shot_loc, "镜头之间有未说明时间段，核实是否有意留空。")
                cursor = max(cursor, end)
            utterances = shot.get("utterances")
            if utterances is None:
                add("SPEECH_UNPROVIDED", "pending", shot_loc, "未提供声音条目，不推定为静默；无声镜头用空数组。")
                continue
            if not isinstance(utterances, list):
                add("UTTERANCES_TYPE", "blocking", shot_loc, "utterances必须为数组。")
                continue
            for utterance_index, utterance in enumerate(utterances):
                speech_loc = f"{shot_loc}.utterances[{utterance_index}]"
                if not isinstance(utterance, dict):
                    add("UTTERANCE_TYPE", "blocking", speech_loc, "声音条目必须是对象。")
                    continue
                uid = utterance.get("id")
                if not nonempty(uid):
                    add("UTTERANCE_ID", "blocking", speech_loc, "逐句ID需要非空字符串。")
                elif uid in seen_utterances:
                    add("UTTERANCE_DUPLICATE", "blocking", speech_loc, "逐句ID重复；跨镜一句应保留单条来源或明确子句映射。")
                else:
                    seen_utterances.add(uid)
                cid = utterance.get("character")
                if not nonempty(cid):
                    add("SPEAKER_REQUIRED", "blocking", speech_loc, "每条声音需明确角色或旁白身份。")
                elif characters is not None and cid not in characters:
                    add("CHARACTER_UNREGISTERED", "blocking", speech_loc, "说话者身份未登记。")
                if require_voice and nonempty(cid) and cid not in voice_characters:
                    add("VOICE_REQUIRED", "blocking", speech_loc, "本项目要求外部音色绑定，但该声音身份未绑定。")
                raw_kind = utterance.get("kind")
                if not nonempty(raw_kind):
                    add("SPEECH_KIND", "blocking", speech_loc, "需要明确声音类型。")
                elif notation.get(raw_kind, raw_kind) not in KINDS:
                    add("SPEECH_NOTATION_UNRESOLVED", "pending", speech_loc, "原声音标记未映射，勿自动把OS当内心独白。")
                if not nonempty(utterance.get("text")):
                    add("SPEECH_TEXT", "blocking", speech_loc, "声音条目需要准确的非空原文。")
                if "start" in utterance or "end" in utterance:
                    spans_shots = utterance.get("spans_shots", False)
                    if not isinstance(spans_shots, bool):
                        add("SPEECH_SPAN_TYPE", "blocking", speech_loc, "spans_shots必须为布尔值。")
                        spans_shots = False
                    speech_span = interval(utterance, speech_loc, duration)
                    if speech_span:
                        if shot_span and not spans_shots:
                            if speech_span[0] < shot_span[0] - EPSILON or speech_span[1] > shot_span[1] + EPSILON:
                                add("SPEECH_SHOT_OVERFLOW", "blocking", speech_loc, "对白超出所属镜头；跨镜对白需明确spans_shots。")
                        utterance_intervals.append((*speech_span, speech_loc))
        if shots and duration is not None and cursor < duration - EPSILON:
            add("SHOT_TAIL_GAP", "review", loc, "组尾有未说明时间段，核实是否为反应/剪辑余量。")
        speech_cursor = -1
        for start, end, speech_loc in sorted(utterance_intervals):
            if start < speech_cursor - EPSILON:
                add("SPEECH_OVERLAP", "review", speech_loc, "声音占用区间重叠，检查是否有意同时发声。")
            speech_cursor = max(speech_cursor, end)
        previous_segment = segment

    counts = {key: sum(issue["severity"] == key for issue in issues) for key in ("blocking", "review", "pending")}
    status = "structural_blockers_found" if counts["blocking"] else (
        "structure_checked_with_pending_items" if counts["review"] or counts["pending"] else "structure_checked_no_blockers")
    return {
        "status": status, "counts": counts, "issues": issues,
        "planned_generation_total_seconds": sum(totals) if totals and all(value is not None for value in totals) else None,
        "caps_evidence": ({key: caps[key] for key in ("provider", "model", "mode", "checked_on", "source")} |
                          {"limits": {key: value for key, value in caps["limits"].items() if key in LIMIT_KEYS}}) if caps else None,
        "limits": "仅核对结构与已提供能力证据；剧情、资产内容、音色、解码及实际生成结果未经此工具验证。",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--caps-file", type=Path)
    parser.add_argument("--check-files", action="store_true")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        document = load_json(args.input)
        caps = load_json(args.caps_file) if args.caps_file else None
        report = audit(document, args.input.resolve().parent, caps, args.check_files)
    except (OSError, UnicodeError, ValueError, TypeError) as exc:
        print(json.dumps({"status": "input_error", "error": str(exc)}, ensure_ascii=False, indent=2))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
    return 1 if report["counts"]["blocking"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
