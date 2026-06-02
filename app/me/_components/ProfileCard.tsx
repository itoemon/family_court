import SectionCard from "./SectionCard";

type ProfileCardProps = {
  titleId: string;
  displayName: string | null;
  avatarUrl: string | null;
  defenseCustomInstructionExcerpt: string | null;
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

export default function ProfileCard({
  titleId,
  displayName,
  avatarUrl,
  defenseCustomInstructionExcerpt,
}: ProfileCardProps) {
  const hasInstruction =
    defenseCustomInstructionExcerpt !== null &&
    defenseCustomInstructionExcerpt.length > 0;

  return (
    <SectionCard
      title="プロフィール"
      titleId={titleId}
      moreHref="/profile"
      moreLabel="プロフィールを編集する"
    >
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center bg-stone-200 shrink-0">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              width={40}
              height={40}
              className="w-full h-full object-cover"
            />
          ) : (
            <UserSilhouette className="w-6 h-6 text-stone-600" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-800 truncate">
            {displayName || "（名前未設定）"}
          </p>
          {hasInstruction ? (
            <p className="text-sm text-stone-500 mt-1 whitespace-pre-wrap break-words">
              {defenseCustomInstructionExcerpt}
            </p>
          ) : (
            <>
              <p className="text-stone-500 text-sm mt-1">
                弁護人カスタム指示は未設定です
              </p>
              <p className="text-stone-400 text-xs mt-0.5">
                プロフィールでカスタム指示を編集できます
              </p>
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
