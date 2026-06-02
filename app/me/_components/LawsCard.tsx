import Link from "next/link";
import SectionCard from "./SectionCard";

type LawRole = "owner" | "member" | "invitee";

type LawDigest = {
  id: string;
  name: string;
  role: LawRole;
};

type LawsCardProps = {
  titleId: string;
  totalCount: number | null;
  recent: LawDigest[];
};

const ROLE_LABEL: Record<LawRole, string> = {
  owner: "オーナー",
  member: "メンバー",
  invitee: "招待中",
};

const ROLE_BADGE_CLASS: Record<LawRole, string> = {
  owner: "text-xs bg-stone-100 text-stone-700 rounded-full px-2 py-0.5",
  member: "text-xs bg-stone-100 text-stone-600 rounded-full px-2 py-0.5",
  invitee: "text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5",
};

function RoleBadge({ role }: { role: LawRole }) {
  return (
    <span className={`shrink-0 ${ROLE_BADGE_CLASS[role]}`}>
      {ROLE_LABEL[role]}
    </span>
  );
}

export default function LawsCard({
  titleId,
  totalCount,
  recent,
}: LawsCardProps) {
  return (
    <SectionCard
      title="参加中の法律"
      titleId={titleId}
      count={totalCount}
      moreHref="/laws"
      moreLabel="参加中の法律をすべて見る"
    >
      {recent.length === 0 ? (
        <div>
          <p className="text-stone-500 text-sm">
            まだ参加している法律はありません
          </p>
          <p className="text-stone-400 text-xs mt-1">
            法律を作成するか、招待を受けるとここに表示されます
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {recent.map((l) => {
            const href = l.role === "invitee" ? "/laws" : `/laws/${l.id}`;
            return (
              <li key={`${l.role}-${l.id}`}>
                <Link
                  href={href}
                  className="flex items-center justify-between gap-3 py-1 text-sm text-stone-800 hover:text-stone-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 rounded"
                >
                  <span className="truncate">{l.name}</span>
                  <RoleBadge role={l.role} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
