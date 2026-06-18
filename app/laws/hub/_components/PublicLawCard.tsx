import type { PublicLawListItem } from "@/lib/types";
import ImportButton from "./ImportButton";

interface Props {
  law: PublicLawListItem;
}

// ISO 文字列の日付部分(UTC)を YYYY/MM/DD で表示する。toLocaleDateString は
// 実行環境の TZ/ロケール依存で SSR/CSR のハイドレーション不一致を起こすため、
// TZ 非依存の決定的フォーマットにする。
function formatDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "/");
}

// 公開法律 1 件の表示カード。article はプレーンテキストで描画し HTML 注入を許さない。
// プレビューは CSS line-clamp で省略する。
export default function PublicLawCard({ law }: Props) {
  return (
    <li className="bg-white border border-stone-200 rounded-xl p-5 space-y-3">
      <div>
        <p className="font-semibold text-stone-800 break-words">{law.name}</p>
        <p className="text-xs text-stone-400 mt-1">
          オーナー: {law.owner_display_name} ・ {formatDate(law.created_at)}
        </p>
      </div>
      <div className="bg-stone-50 rounded-lg p-3">
        <p className="text-stone-700 text-sm whitespace-pre-wrap leading-relaxed line-clamp-4">
          {law.article}
        </p>
      </div>
      <div className="flex justify-end">
        <ImportButton lawId={law.id} />
      </div>
    </li>
  );
}
