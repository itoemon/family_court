#!/usr/bin/env python3
"""トークン消費レポート。

source ごとにアダプタを持ち、共通スキーマ (Turn) に正規化したうえで集計する。
将来 Codex CLI を追加する場合は `iter_codex_turns()` を実装して
SOURCES に登録するだけで全集計に乗る。

Usage:
    scripts/token_report.py [--source claude|codex|all] [--days N]
                            [--by day|session|model|branch] [--project SUBSTR]
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Iterable, Iterator

CLAUDE_PROJECTS_DIR = os.path.expanduser("~/.claude/projects")


@dataclass(frozen=True)
class Turn:
    """1 ターン (assistant 応答) の正規化済み消費レコード。"""

    source: str  # "claude" | "codex" | ...
    session_id: str
    timestamp: dt.datetime
    model: str
    input_tokens: int
    output_tokens: int
    cache_creation: int
    cache_read: int
    cwd: str | None
    branch: str | None

    @property
    def total_in_equivalent(self) -> int:
        """入力換算合計 (キャッシュ込み)。コンテキスト負荷の目安。"""
        return self.input_tokens + self.cache_creation + self.cache_read


def iter_claude_turns(project_filter: str | None = None) -> Iterator[Turn]:
    """~/.claude/projects/*/*.jsonl から Claude Code のターンを取り出す。"""
    pattern = os.path.join(CLAUDE_PROJECTS_DIR, "*", "*.jsonl")
    for path in glob.glob(pattern):
        if project_filter and project_filter not in path:
            continue
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    try:
                        d = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    msg = d.get("message") or {}
                    if not isinstance(msg, dict):
                        continue
                    model = msg.get("model")
                    if not model or model == "<synthetic>":
                        continue
                    u = msg.get("usage") or {}
                    ip = u.get("input_tokens") or 0
                    op = u.get("output_tokens") or 0
                    cw = u.get("cache_creation_input_tokens") or 0
                    cr = u.get("cache_read_input_tokens") or 0
                    if not (ip or op or cw or cr):
                        continue
                    ts_raw = d.get("timestamp") or ""
                    try:
                        ts = dt.datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                    except ValueError:
                        ts = dt.datetime.fromtimestamp(0, tz=dt.timezone.utc)
                    yield Turn(
                        source="claude",
                        session_id=d.get("sessionId") or os.path.basename(path),
                        timestamp=ts,
                        model=model,
                        input_tokens=ip,
                        output_tokens=op,
                        cache_creation=cw,
                        cache_read=cr,
                        cwd=d.get("cwd"),
                        branch=d.get("gitBranch"),
                    )
        except OSError:
            continue


def iter_codex_turns() -> Iterator[Turn]:
    """Codex CLI 用アダプタ。未実装 (Codex 組み込み時に実装する)。"""
    return iter(())


SOURCES: dict[str, Callable[[], Iterable[Turn]]] = {
    "claude": iter_claude_turns,
    "codex": iter_codex_turns,
}


def fmt(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:>6.2f}M"
    if n >= 1_000:
        return f"{n / 1_000:>6.1f}k"
    return f"{n:>7d}"


def aggregate(turns: Iterable[Turn], key_fn: Callable[[Turn], str]) -> dict[str, dict[str, int]]:
    agg: dict[str, dict[str, int]] = defaultdict(
        lambda: {"in": 0, "out": 0, "cw": 0, "cr": 0, "turns": 0}
    )
    for t in turns:
        k = key_fn(t)
        agg[k]["in"] += t.input_tokens
        agg[k]["out"] += t.output_tokens
        agg[k]["cw"] += t.cache_creation
        agg[k]["cr"] += t.cache_read
        agg[k]["turns"] += 1
    return agg


def print_table(agg: dict[str, dict[str, int]], key_label: str, *, sort_desc: bool = True) -> None:
    items = sorted(agg.items(), key=lambda kv: kv[1]["cr"] + kv[1]["cw"], reverse=sort_desc)
    print(f"{key_label:<28}  {'turns':>6}  {'input':>8}  {'output':>8}  {'cache_w':>8}  {'cache_r':>8}")
    print("-" * 80)
    tot = {"in": 0, "out": 0, "cw": 0, "cr": 0, "turns": 0}
    for k, v in items:
        print(
            f"{k:<28}  {v['turns']:>6d}  {fmt(v['in'])}  {fmt(v['out'])}  "
            f"{fmt(v['cw'])}  {fmt(v['cr'])}"
        )
        for kk in tot:
            tot[kk] += v[kk]
    print("-" * 80)
    print(
        f"{'TOTAL':<28}  {tot['turns']:>6d}  {fmt(tot['in'])}  {fmt(tot['out'])}  "
        f"{fmt(tot['cw'])}  {fmt(tot['cr'])}"
    )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="トークン消費レポート")
    p.add_argument("--source", choices=["claude", "codex", "all"], default="claude")
    p.add_argument("--days", type=int, default=None, help="直近 N 日に絞る")
    p.add_argument("--by", choices=["day", "session", "model", "branch"], default="day")
    p.add_argument(
        "--project",
        default=None,
        help="JSONL ファイルパスの部分一致でフィルタ "
        "(~/.claude/projects/<cwd エスケープ>/*.jsonl が対象。実質 cwd 単位で絞れる)",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    src_keys = list(SOURCES.keys()) if args.source == "all" else [args.source]

    turns: list[Turn] = []
    for k in src_keys:
        if k == "claude":
            turns.extend(iter_claude_turns(project_filter=args.project))
        else:
            turns.extend(SOURCES[k]())

    if args.days is not None:
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=args.days)
        turns = [t for t in turns if t.timestamp >= cutoff]

    if not turns:
        print("該当データなし", file=sys.stderr)
        return 1

    key_fns = {
        "day": lambda t: t.timestamp.astimezone().strftime("%Y-%m-%d"),
        "session": lambda t: t.session_id[:8],
        "model": lambda t: t.model,
        "branch": lambda t: t.branch or "(no branch)",
    }
    label_map = {"day": "DATE", "session": "SESSION", "model": "MODEL", "branch": "BRANCH"}
    agg = aggregate(turns, key_fns[args.by])

    print(f"source: {','.join(src_keys)}  / by: {args.by}  / turns: {len(turns)}")
    print()
    print_table(agg, label_map[args.by])
    return 0


if __name__ == "__main__":
    sys.exit(main())
