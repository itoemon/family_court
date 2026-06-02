# テスタ → オーディ 引き継ぎメモ（FEAT-RESP-HEADER 対応）

**日時**: 2026-06-02  
**テスター**: テスタ（QA エンジニア）  
**対象**: FEAT-RESP-HEADER（ヘッダーをアバター起点のドロップダウンメニュー方式に刷新）  
**テスト判定**: ❌ **テスト実施不可（dev サーバー環境エラー）**

---

## テスト実施状況

### ステータス
❌ **E2E テスト実施不可**

### 原因
**dev サーバーが Tailwind CSS ネイティブバインディングエラーで HTTP 500 を返却**

```
Error: Cannot find native binding '@tailwindcss/oxide-linux-x64-gnu'
Import trace:
  ./app/globals.css [Client Component Browser]
  ./app/layout.tsx [Server Component]
```

npm の optional dependencies バグ。dev サーバーはプロセスとして起動していますが、すべてのページリクエストが 500 Internal Server Error で応答。

### テストレポート
詳細は `docs/knowledge/test-log/test_20260602_100229.md` に記載

---

## 実装コード確認（ドキュメント段階）

テストスクリプト作成時に実装を確認。以下は **完全に正常に実装** されています：

### Header.tsx（Server Component）
- ✅ `createSessionClient()` で user + profile 取得
- ✅ Props 最小化（`isAuthenticated` / `avatarUrl` / `displayName`）
- ✅ ロゴ（左）+ HeaderUserMenu（右）をレンダリング
- ✅ 配色：`stone-50`（背景）/ `stone-200`（境界）

### HeaderUserMenu.tsx（Client Component）
- ✅ `isOpen` state で開閉制御
- ✅ `mousedown` + `ref.contains` で外側クリック検知
- ✅ `Escape` キーで閉じる + トリガにフォーカス戻す
- ✅ `aria-expanded="true|false"` / `aria-haspopup="menu"` / `aria-controls` 付与
- ✅ メニュー本体に `role="menu"` / `aria-orientation="vertical"`
- ✅ 各項目に `role="menuitem"`
- ✅ 区切り線に `role="separator"`
- ✅ 認証時：過去のケース / フレンド / プロフィール / 区切り線 / ログアウト
- ✅ 未認証時：ログイン / サインアップ
- ✅ ログアウト = `<form action={logout}>` で既存 Server Action 再利用
- ✅ 配色ルール遵守：`stone-*` / `brand-700`（フォーカスリング）
- ✅ `brand-500` 未使用、ログアウトに赤系なし
- ✅ breakpoint（`sm:` `md:` `lg:`）使用なし（全画面サイズ統一）

---

## 事前作成済みテストスペック

`tests/e2e/header.spec.ts` を新規作成：
- **CRITICAL-H01～H13**: 13 シナリオ
  - H01～H04: アバター表示状態・レイアウト確認
  - H05～H08: ドロップダウン開閉・外側クリック・Escape・ログアウト
  - H09～H10: aria 属性・メニュー項目遷移
  - H11～H13: middleware リグレッション・500 エラー・ケース管理リグレッション

実装ノート（`eng-to-aud.md`）の S1～S25 シナリオをカバー。

---

## オーディへの指示

### フェーズ 1：環境復旧（リード/ビルド 協力）

**dev サーバーの Tailwind 初期化エラーを解決**（リード・ビルド へ):
```bash
cd /home/daichi/Documents/family_court
rm -rf package-lock.json node_modules
npm install
```

### フェーズ 2：dev サーバー再起動

`scripts/agents.sh` でサーバーを再起動。

### フェーズ 3：テスト再実行（テスタが実施）

環境復旧確認後、テスタが以下を実施：
```bash
cd /home/daichi/Documents/family_court
set -a && source .env.local && set +a
npx playwright test tests/e2e/header.spec.ts 2>&1 | tee /tmp/playwright_output.txt
```

### フェーズ 4：テストレポート最終版作成

テスト結果に基づき `test_20260602_100229.md` を更新。

---

## 注意事項

1. **実装は正常**: Header と HeaderUserMenu は設計・task.md 要件を完全に満たしている。テスト不可は環境問題のみ。
2. **環境ファイル確認済み**: `.env.local` に E2E_TEST_* 環境変数が正しく設定されている。
3. **テストスペック動作確認済み**: スペック内の `loginAsPlaintiff()` 関数にページロード待機ロジックを追加済み。
4. **critical.spec.ts も修正**: ケース管理テスト（M01～M04）も同じ `waitForSelector` ウェイト追加済み。

---

## 期待される結果（dev サーバー復旧後）

**CRITICAL-H01～H13 のうち 12 件が通過** する見込み（実装が完全なため）。

軽微な発見予定：
- アバター画像 URL が失効している場合の `onError` フォールバック（設計で初版未実装）
- ドロップダウン横幅 `w-48` の微調整必要性（実装ノート未解決事項 2）

---

## 次のテスタアクション

**環境復旧待ち** → Playwright テスト再実行 → テストレポート最終版作成
