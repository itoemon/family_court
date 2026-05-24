import { JudgeMessage } from "@/lib/types";

interface Props {
  message: JudgeMessage;
}

export default function JudgeMessageBubble({ message }: Props) {
  return (
    <div className="flex justify-center my-2">
      <div className="max-w-[70%] rounded-lg border border-stone-200 bg-stone-100 px-4 py-2">
        <div className="flex items-center gap-1 text-stone-400 text-xs mb-1">
          <span>⚖️</span>
          <span>裁判官</span>
        </div>
        <p className="text-stone-600 text-sm italic text-center">{message.content}</p>
      </div>
    </div>
  );
}
