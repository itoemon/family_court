# マルチエージェント開発テンプレート
3役のClaudeエージェントでアプリケーションを開発するテンプレート。

## セットアップ

```bash
# 1. Claude Codeをインストール
curl -fsSL https://claude.ai/install.sh | sh

# 2. ログイン
claude

# 3. このディレクトリに移動
cd todo-agent-demo

# 4. 実行権限を付与
chmod +x multi-agent-pipeline.sh agents.sh
```

## 使い方

### パターンA: 全部自動で流す
```bash
./multi-agent-pipeline.sh
```
設計者 → 実装者 → 審査者 の順に自動実行される。

### パターンB: 1エージェントずつ対話しながら進める
```bash
# 設計者と対話
./agents.sh architect

# 実装者と対話
./agents.sh engineer

# 審査者と対話
./agents.sh auditor
```

## ディレクトリ構成

```
todo-agent-demo/
├── CLAUDE.md                    ← プロジェクトルール（全エージェントが読む）
├── multi-agent-pipeline.sh      ← 全自動パイプライン
├── agents.sh                    ← 単体エージェント呼び出し
├── knowledge/
│   ├── requirements/
│   │   └── requirements.md          ← 要件定義書（ここを編集してスタート）
│   ├── design/
│   │   └── design.md            ← 設計者が生成（自動作成）
│   └── audit-log/
│       └── audit_YYYYMMDD.md    ← 審査者が生成（自動作成）
└── src/                         ← 実装者が生成（自動作成）
```

## カスタマイズ方法

### 別のアプリを作りたい場合
`knowledge/requirements/requirements.md` の要件を書き換えるだけでOK。

### エージェントの役割を変えたい場合
`multi-agent-pipeline.sh` の `--system` の中身を編集する。
