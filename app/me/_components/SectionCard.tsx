import Link from "next/link";
import type { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  titleId: string;
  count?: number | null;
  moreHref: string;
  moreLabel: string;
  children: ReactNode;
};

export default function SectionCard({
  title,
  titleId,
  count,
  moreHref,
  moreLabel,
  children,
}: SectionCardProps) {
  const showBadge = count !== undefined && count !== null;

  return (
    <section
      aria-labelledby={titleId}
      className="bg-white border border-stone-200 rounded-2xl shadow-sm p-5"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h2
            id={titleId}
            className="text-base font-semibold text-stone-800 truncate"
          >
            {title}
          </h2>
          {showBadge && (
            <span className="shrink-0 text-xs bg-stone-100 text-stone-500 rounded-full px-2 py-0.5">
              {count}件
            </span>
          )}
        </div>
        <Link
          href={moreHref}
          aria-label={moreLabel}
          className="shrink-0 text-sm text-brand-700 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 rounded"
        >
          {moreLabel}
        </Link>
      </div>
      <div>{children}</div>
    </section>
  );
}
