import { NextRequest, NextResponse } from "next/server";
import { getCase, saveCase } from "@/lib/store";
import { requestVerdict } from "@/lib/claude";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const c = getCase(id);
  if (!c) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  if (c.phase !== "judging") {
    return NextResponse.json({ error: "まだ判決を下せるフェーズではありません" }, { status: 409 });
  }

  const verdict = await requestVerdict(c);
  c.verdict = verdict;
  c.phase = "verdict";
  c.updatedAt = new Date().toISOString();
  saveCase(c);
  return NextResponse.json(c);
}
