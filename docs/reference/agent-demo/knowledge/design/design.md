# Todo アプリ 設計書

## 1. コンポーネント構成

```
App
├── TodoHeader          # アプリタイトル表示
├── TodoForm            # タスク入力フォーム（追加ボタン含む）
├── TodoFilter          # フィルタータブ（全件 / 未完了 / 完了）
├── TodoList            # タスク一覧（フィルター済みリストを受け取る）
│   └── TodoItem        # タスク1件（チェックボックス・ラベル・削除ボタン）
└── TodoFooter          # 残タスク件数表示
```

### 各コンポーネントの責務

| コンポーネント | 責務 |
|---|---|
| `App` | 状態管理・ロジック全般のルートコンテナ |
| `TodoHeader` | タイトル表示のみ（ロジックなし） |
| `TodoForm` | 入力値のローカルstate管理・送信イベント発火 |
| `TodoFilter` | 現在のフィルター状態表示・切替イベント発火 |
| `TodoList` | タスク配列を受け取りリスト描画 |
| `TodoItem` | 1件のタスク表示・完了切替・削除イベント発火 |
| `TodoFooter` | 未完了件数の表示のみ |

---

## 2. データ構造（TypeScript 型定義）

```ts
/** タスク1件 */
type Todo = {
  id: string;          // crypto.randomUUID() で生成
  text: string;        // タスク本文（空文字禁止）
  completed: boolean;  // 完了フラグ
  createdAt: number;   // Date.now() のタイムスタンプ（ソート用）
};

/** フィルターの種別 */
type FilterType = "all" | "active" | "completed";

/** App が保持するルートstate */
type AppState = {
  todos: Todo[];
  filter: FilterType;
};
```

---

## 3. 状態管理の方針

### 方針: `useReducer` + Context（シンプル単一ページ構成）

- 状態は `App` コンポーネントに集約し、`useReducer` で管理する。
- Props drilling が深くなる場合に備え、`TodoContext` を設けて `dispatch` と `filter` を配布する。
- 外部ライブラリ（Redux / Zustand 等）は導入しない（要件がシンプルなため不要）。
- `localStorage` にシリアライズして永続化し、初期ロード時に復元する。

### アクション定義

```ts
type Action =
  | { type: "ADD_TODO";    text: string }
  | { type: "TOGGLE_TODO"; id: string }
  | { type: "DELETE_TODO"; id: string }
  | { type: "SET_FILTER";  filter: FilterType };
```

### Reducer の責務分割

```
reducer(state, action) → newState
  ├── ADD_TODO    : 新 Todo を先頭に追加
  ├── TOGGLE_TODO : 対象 id の completed を反転
  ├── DELETE_TODO : 対象 id を除外
  └── SET_FILTER  : filter を更新
```

### フィルタリング

Reducer ではなく表示直前に派生値として算出する（selector パターン）。

```ts
const filteredTodos = useMemo(() => {
  if (filter === "active")    return todos.filter(t => !t.completed);
  if (filter === "completed") return todos.filter(t => t.completed);
  return todos;
}, [todos, filter]);
```

---

## 4. ファイル構成

```
src/
├── components/
│   ├── TodoHeader/
│   │   ├── TodoHeader.tsx
│   │   └── TodoHeader.module.css
│   ├── TodoForm/
│   │   ├── TodoForm.tsx
│   │   └── TodoForm.module.css
│   ├── TodoFilter/
│   │   ├── TodoFilter.tsx
│   │   └── TodoFilter.module.css
│   ├── TodoList/
│   │   ├── TodoList.tsx
│   │   └── TodoList.module.css
│   ├── TodoItem/
│   │   ├── TodoItem.tsx
│   │   └── TodoItem.module.css
│   └── TodoFooter/
│       ├── TodoFooter.tsx
│       └── TodoFooter.module.css
├── context/
│   └── TodoContext.ts      # Context + useContext フック
├── hooks/
│   └── useTodos.ts         # useReducer + localStorage 永続化ロジック
├── types/
│   └── todo.ts             # Todo / FilterType / Action 型定義
├── App.tsx                 # ルートコンポーネント・状態管理エントリ
├── App.module.css
└── main.tsx                # エントリポイント
```

### 補足: スタイリング指針

- CSS Modules を採用（TailwindCSS はユーティリティクラスの増殖を防ぐため不採用）。
- グローバルリセットは `src/index.css` に定義。
- テーマカラー・フォントなどは CSS カスタムプロパティで一元管理。
