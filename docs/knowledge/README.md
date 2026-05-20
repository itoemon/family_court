# docs/knowledge/ — パイプライン作業領域

パイプラインを構成するエージェントが読み書きするディレクトリです。

---

## ディレクトリ構造

```
docs/knowledge/
├── requirements.md   ← リードが書く（永続）
├── environment.md    ← リードが書く（永続）
├── design.md         ← アーキが書く（永続・上書き）
├── task.md           ← リード/ダイチが書く（使い捨て・毎パイプライン更新）
├── handoff/
│   ├── arch-to-eng.md   ← アーキ→ビルド 引き継ぎ（使い捨て）
│   ├── eng-to-aud.md    ← ビルド→テスタ・オーディ 引き継ぎ（使い捨て）
│   └── test-to-aud.md   ← テスタ→オーディ 引き継ぎ（使い捨て）
├── test-log/         ← テスタが書く（蓄積）
└── audit-log/        ← オーディが書く（蓄積）
```

---

## エージェントの権限サマリー

| エージェント | 読む | 書く |
|---|---|---|
| アーキ | requirements.md, environment.md, task.md, decisions/ | design.md, handoff/arch-to-eng.md |
| ビルド | design.md, environment.md, task.md, handoff/arch-to-eng.md | app/, lib/, supabase/, handoff/eng-to-aud.md |
| テスタ | design.md, requirements.md, task.md, handoff/eng-to-aud.md | test-log/, handoff/test-to-aud.md |
| オーディ | design.md, requirements.md, environment.md, task.md, handoff/eng-to-aud.md, handoff/test-to-aud.md | audit-log/ |
| リード | すべて | requirements.md, environment.md, task.md |
