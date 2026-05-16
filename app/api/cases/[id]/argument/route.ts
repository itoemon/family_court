import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getCase, saveCase } from "@/lib/store";
import { AddArgumentRequest } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const c = getCase(id);
  if (!c) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  if (c.phase === "waiting" || c.phase === "judging" || c.phase === "verdict") {
    return NextResponse.json({ error: "現在は発言できないフェーズです" }, { status: 409 });
  }

  const body: AddArgumentRequest = await req.json();
  if (body.role !== c.currentTurn) {
    return NextResponse.json({ error: "あなたのターンではありません" }, { status: 409 });
  }
  if (!body.content?.trim()) {
    return NextResponse.json({ error: "発言内容は必須です" }, { status: 400 });
  }

  const now = new Date().toISOString();
  c.arguments.push({
    id: uuidv4(),
    role: body.role,
    phase: c.phase,
    round: c.round,
    content: body.content.trim(),
    timestamp: now,
  });

  // ターン交代・フェーズ進行
  if (c.currentTurn === "plaintiff") {
    c.currentTurn = "defendant";
  } else {
    // 被告が発言したので1ラウンド完了
    c.currentTurn = "plaintiff";
    c.round += 1;

    if (c.phase === "opening") {
      c.phase = "argument";
      c.round = 1;
    } else if (c.phase === "argument" && c.round > c.maxRounds) {
      c.phase = "closing";
      c.round = 1;
    } else if (c.phase === "closing") {
      c.phase = "judging";
    }
  }

  c.updatedAt = now;
  saveCase(c);
  return NextResponse.json(c);
}
