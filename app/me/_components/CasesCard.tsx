import Link from "next/link";
import SectionCard from "./SectionCard";

type CaseDigest = {
  id: string;
  topic: string;
  createdAt: string;
};

type CasesCardProps = {
  titleId: string;
  totalCount: number | null;
  recent: CaseDigest[];
};

export default function CasesCard({
  titleId,
  totalCount,
  recent,
}: CasesCardProps) {
  return (
    <SectionCard
      title="過去のケース"
      titleId={titleId}
      count={totalCount}
      moreHref="/history"
      moreLabel="過去のケースをすべて見る"
    >
      {recent.length === 0 ? (
        <div>
          <p className="text-stone-500 text-sm">
            まだ判決が出たケースはありません
          </p>
          <p className="text-stone-400 text-xs mt-1">
            ホームからケースを作成して話し合いを始められます
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {recent.map((c) => (
            <li key={c.id}>
              <Link
                href={`/case/${c.id}`}
                className="flex items-center justify-between gap-3 py-1 text-sm text-stone-800 hover:text-stone-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 rounded"
              >
                <span className="truncate">{c.topic}</span>
                <span className="shrink-0 text-xs text-stone-400">
                  {new Date(c.createdAt).toLocaleDateString("ja-JP")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
