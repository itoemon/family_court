import SectionCard from "./SectionCard";

type FriendDigest = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

type FriendsCardProps = {
  titleId: string;
  totalCount: number | null;
  recent: FriendDigest[];
};

function UserSilhouette({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8.5C5 16.91 8.13 14 12 14s7 2.91 7 6.5v.5H5v-.5Z"
      />
    </svg>
  );
}

export default function FriendsCard({
  titleId,
  totalCount,
  recent,
}: FriendsCardProps) {
  return (
    <SectionCard
      title="フレンド"
      titleId={titleId}
      count={totalCount}
      moreHref="/friends"
      moreLabel="フレンドを管理する"
    >
      {recent.length === 0 ? (
        <div>
          <p className="text-stone-500 text-sm">まだフレンドはいません</p>
          <p className="text-stone-400 text-xs mt-1">
            フレンドを追加すると、ここに最近の 5 人が表示されます
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {recent.map((f) => (
            <li key={f.id} className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-stone-200 shrink-0">
                {f.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.avatarUrl}
                    alt=""
                    width={32}
                    height={32}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <UserSilhouette className="w-5 h-5 text-stone-600" />
                )}
              </span>
              <span className="text-sm text-stone-800 truncate">
                {f.displayName || "（名前未設定）"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
