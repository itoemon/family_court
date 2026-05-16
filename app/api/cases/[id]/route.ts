import { NextRequest, NextResponse } from "next/server";
import { getCase, saveCase } from "@/lib/store";
import { JoinCaseRequest } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const c = getCase(id);
  if (!c) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  return NextResponse.json(c);
}

// 被告が参加する
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const c = getCase(id);
  if (!c) return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  if (c.defendant) return NextResponse.json({ error: "既に被告が参加しています" }, { status: 409 });

  const body: JoinCaseRequest = await req.json();
  if (!body.defendantName?.trim()) {
    return NextResponse.json({ error: "被告名は必須です" }, { status: 400 });
  }

  const now = new Date().toISOString();
  c.defendant = { name: body.defendantName.trim(), joinedAt: now };
  c.phase = "opening";
  c.updatedAt = now;
  saveCase(c);
  return NextResponse.json(c);
}
