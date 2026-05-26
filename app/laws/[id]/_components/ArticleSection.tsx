interface Props {
  lawId: string;
  name: string;
  article: string;
  updatedAt: string;
}

export default function ArticleSection({ name, article, updatedAt }: Props) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-stone-800">{name}</h1>
        <p className="text-xs text-stone-400 mt-1">
          最終更新: {new Date(updatedAt).toLocaleDateString("ja-JP")}
        </p>
      </div>
      <div className="bg-stone-50 rounded-lg p-4">
        <p className="text-stone-700 text-sm whitespace-pre-wrap leading-relaxed">{article}</p>
      </div>
    </div>
  );
}
