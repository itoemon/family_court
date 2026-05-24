import { ContradictionWarning } from "@/lib/types";

export default function ContradictionWarningBubble({
  warning,
}: {
  warning: ContradictionWarning;
}) {
  return (
    <div className="flex justify-center my-1">
      <div className="inline-flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 max-w-sm text-sm text-amber-700">
        <span className="shrink-0 mt-0.5">⚠️</span>
        <p>{warning.message}</p>
      </div>
    </div>
  );
}
