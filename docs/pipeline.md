# 開発パイプライン

> **★2026-07-16 ゼロベース再設計**: 実行基盤を `scripts/agents.sh`（nested `claude -p`）から
> **「リードが harness の Agent ツール（独立サブエージェント）で各役割を編成する」**方式へ全面移行した。
> `agents.sh` は無出力死・観測性ゼロ・孤児化により信頼できず **deprecated**。本書は現行方式を記す。

## 全体フロー

```
ダイチ + リード（要件定義・task.md 執筆。product 数値はダイチ確認）
        ↓
    アーキ〔harness サブエージェント〕 詳細設計を design.md 末尾に純追記
        ↓  リードが設計レビュー（既存削除なし・原子性・認可の妥当性）
    ビルド〔harness サブエージェント〕 実装（tsc/eslint 緑まで）
        ↓  リードが実装レビュー（money-critical の核心は自分で読む）
    テスト（リード直の playwright fast-path）＋ リードのアドバサリアル検証
        ↓  お金/認可系は REST 直で 403/429・並行で上限超えなし等を実証
    オーディ〔harness サブエージェント〕 独立セキュリティ監査（コード読み取り専用）
        ↓  HIGH 0件 & 指摘 5件以下？（auth/決済/RLS/暗号/お金は監査必須）
      No → 指摘を消化（軽微は PR 内、重いものは差し戻し）／未修正は backlog へ
      Yes ↓
    リードが PR 作成（gh pr create）
        ↓
    コパ（GitHub Copilot）初回レビューを待って確認 → 指摘を PR 内消化
        ↓  CI 緑確認
    main マージ → 本番デプロイ → リードが memory / backlog 更新
```

**独立したセキュリティの目が 3 層**（オーディ＋リードのアドバサリアル＋コパ）。リードは PM に徹し、
実装・監査を別インスタンスの独立サブエージェントに分けて盲点を埋める。ただし harness の信頼性が高い今、
中断・環境障害でサブエージェントが詰まったらリードが直接引き取って完遂してよい。

---

## 指示の優先順位

| 優先度 | ドキュメント | 更新者 | 性質 |
|--------|---|---|---|
| 1（最高）| `docs/knowledge/task.md` | リード | 使い捨て（毎パイプライン執筆） |
| 2 | `docs/knowledge/design.md` | アーキ〔subagent〕 | 永続（末尾に純追記・削除/書き換え禁止） |
| 3 | `docs/knowledge/requirements.md` / `environment.md` | リード | 永続（蓄積） |

---

## エージェント一覧

| 名前 | 役割 | 実体 / 呼び出し |
|---|---|---|
| リード | 要件定義・設計/コードレビュー・テスト・アドバサリアル・PR・編成 | このチャット（harness） |
| アーキ | 詳細設計（design.md 追記） | **harness `Agent` ツール（general-purpose）をリードが起動** |
| ビルド | 実装 | **harness `Agent` ツール（general-purpose）をリードが起動** |
| オーディ | 独立セキュリティ監査（読み取り専用） | **harness `Agent` ツール（general-purpose）をリードが起動** |
| テスタ | E2E（Playwright） | リード直の fast-path（agent 化しない） |
| コパ | PR レビュー | GitHub Copilot（Ruleset が自動起動） |

各サブエージェントへのプロンプトは**自己完結**にする（会話コンテキストを持たないため、参照ファイルの
絶対パス・厳守事項・最終報告の形式を明記）。実装するサブエージェントと監査するサブエージェントは
**別インスタンス**にして独立性を担保する。

---

## 指摘への対応ルール

| 種別 | 対応者 |
|---|---|
| 誤記・参照ミス | リードが直接修正 |
| 設計判断の変更 | アーキ（subagent）を再起動、or リードが design を直接修正 |
| テスト失敗 | ビルド（subagent）を再起動、or リードが直接修正 |
| 監査 HIGH / コパ指摘 | PR 内で消化（軽微はリード直・大きいものは再ビルド） |
| 対応保留（LOW など） | `docs/backlog.md` に追記 |

---

## スクリプト（補助・deprecated 含む）

- `scripts/setup-test-db.sh` — テスト DB セットアップ（schema.sql → migrations 一括適用・本番 ref ブロック・`--dry-run` / `--clean-cases`）。**現役**。
- `scripts/agents.sh` — **DEPRECATED**（nested `claude -p`）。パイプラインの実行基盤としては使わない。参照・緊急時の手動フォールバック用に残置。
- 将来「リード不在の完全自律実行」が要るときは、`agents.sh` 延命でなく **Workflow（決定論的マルチエージェント編成・opt-in）** で作り直す。
