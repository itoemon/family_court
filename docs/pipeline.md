# 開発パイプライン

## 全体フロー

```
ダイチ + リード（要件定義・task.md 更新）
        ↓
    アーキ（詳細設計書・arch-to-eng.md 生成）
        ↓
    ビルド（実装・eng-to-aud.md 生成）
        ↓
    テスタ（E2E テスト・test-to-aud.md 生成）
        ↓ CRITICAL 失敗？
      Yes → ビルドのみ差し戻し（最大3回）
      No  ↓
    オーディ（セキュリティ監査）
        ↓ HIGH 0件 & 指摘 5件以下？
      No → アーキに差し戻し（最大3回）
      Yes ↓
    PR 自動作成（gh pr create）
        ↓
    コパ（PR レビュー）
        ↓
    ダイチが動作確認
        ↓ OK？
      No → リードに差し戻し
      Yes ↓
    main マージ → 本番デプロイ
```

---

## 指示の優先順位

| 優先度 | ドキュメント | 更新者 | 性質 |
|--------|---|---|---|
| 1（最高）| `docs/knowledge/task.md` | リード/ダイチ | 使い捨て（毎パイプライン更新） |
| 2 | `docs/knowledge/handoff/*.md` | 各エージェント | 使い捨て（補足のみ、task.md と矛盾不可） |
| 3 | `docs/knowledge/design.md` | アーキ | 永続（蓄積） |
| 4 | `docs/knowledge/requirements.md` | リード | 永続（蓄積） |
| 4 | `docs/knowledge/environment.md` | リード | 永続（蓄積） |

---

## エージェント一覧

| 名前 | 役割 | 呼び出し |
|---|---|---|
| リード | 要件定義・方針決定・パイプライン起動 | このチャット |
| アーキ | 詳細設計書生成 | `./scripts/agents.sh architect` |
| ビルド | 実装 | `./scripts/agents.sh engineer` |
| テスタ | E2E テスト（Playwright） | `./scripts/agents.sh tester` |
| オーディ | セキュリティ監査 | `./scripts/agents.sh auditor` |
| コパ | PR レビュー（GitHub Copilot） | GitHub Ruleset が自動起動 |

---

## 指摘への対応ルール

| 種別 | 対応者 |
|---|---|
| 誤記・参照ミス | リードが直接修正 |
| 設計判断の変更 | アーキに差し戻し |
| テスト CRITICAL 失敗 | ビルドに差し戻し |
| 対応保留（LOW など） | `docs/backlog.md` に追記 |

---

## スクリプト

```bash
# パイプライン全自動実行
./scripts/pipeline.sh

# エージェント個別呼び出し
./scripts/agents.sh architect
./scripts/agents.sh engineer
./scripts/agents.sh tester
./scripts/agents.sh auditor
```
