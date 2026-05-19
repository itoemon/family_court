# 開発パイプライン

## 全体フロー

```
ダイチ + リード（要件定義）
        ↓
    アーキ（設計書作成）
        ↓
    ビルド（実装）
        ↓
    オーディ（監査）
        ↓ HIGH 0件 & 指摘 5件以下？
      No → アーキに差し戻し（最大3回）
      Yes ↓
    PR 自動作成（gh pr create）
        ↓
    コパ（PR レビュー）
        ↓ 承認？
      No → PR 差し戻し → ダイチに通知
      Yes ↓
    QA 環境へ自動デプロイ（Vercel Preview）
        ↓
    ダイチが動作確認
        ↓ OK？
      No → リードに差し戻し
      Yes ↓
    main マージ → 本番デプロイ
```

---

## 各ステップの詳細

### 1. 要件定義（リード）

ダイチとリードの対話で作成。以下を `docs/knowledge/requirements/` に保存する：

- `requirements.md` — 機能要件・非機能要件
- `review-criteria.md` — オーディ・コパへの評価観点（リードが事前に作成）

### 2. 設計（アーキ）

- `docs/knowledge/requirements/` を読む
- `docs/knowledge/design/design.md` を出力

### 3. 実装（ビルド）

- `docs/knowledge/design/design.md` を読む
- feature ブランチを作成してコードを実装
- コミットまで行う（プッシュはしない）

### 4. 監査（オーディ）

- 実装コード・設計書・要件書を読む
- `docs/knowledge/audit-log/audit_YYYYMMDD_HHMMSS.md` を出力
- **ループ継続条件**: `severity: HIGH` が 1 件以上、または指摘総数が 5 件超
- 最大 3 回ループ。超えた場合はダイチに判断を委ねる

### 5. PR 作成

監査通過後にパイプラインが自動で `gh pr create` を実行。

PR 説明文に以下を含める：
- 実装内容のサマリー
- 要件との対応
- 設計上の主な判断
- 監査結果（HIGH: 0件 / MEDIUM: N件 対応済み）

### 6. コパによるレビュー

GitHub Actions がトリガー。PR 差分 + PR 説明文を元にレビュー。

---

## スクリプト

```bash
# パイプライン全自動実行
./scripts/pipeline.sh

# エージェント個別呼び出し
./scripts/agents.sh architect
./scripts/agents.sh engineer
./scripts/agents.sh auditor
```

スクリプトは `scripts/` に配置（実装は別途）。
