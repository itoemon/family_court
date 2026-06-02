import Link from "next/link";

type MeHeaderProps = {
  displayName: string | null;
  avatarUrl: string | null;
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

export default function MeHeader({ displayName, avatarUrl }: MeHeaderProps) {
  const label = displayName || "（名前未設定）";

  return (
    <div className="flex items-center gap-4">
      <span className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center bg-stone-200 shrink-0">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={displayName || "プロフィール画像"}
            width={64}
            height={64}
            className="w-full h-full object-cover"
          />
        ) : (
          <UserSilhouette className="w-10 h-10 text-stone-600" />
        )}
      </span>
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-stone-800 truncate">{label}</h1>
        <Link
          href="/profile"
          aria-label="プロフィールを編集する"
          className="text-sm text-brand-700 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 rounded"
        >
          プロフィールを編集する
        </Link>
      </div>
    </div>
  );
}
