import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { saveCase } from "@/lib/store";
import { Case, CreateCaseRequest } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body: CreateCaseRequest = await req.json();

  if (!body.topic?.trim() || !body.plaintiffName?.trim()) {
    return NextResponse.json({ error: "議題と原告名は必須です" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const newCase: Case = {
    id: uuidv4(),
    topic: body.topic.trim(),
    plaintiff: { name: body.plaintiffName.trim(), joinedAt: now },
    defendant: null,
    arguments: [],
    phase: "waiting",
    currentTurn: "plaintiff",
    round: 1,
    maxRounds: body.maxRounds ?? 3,
    verdict: null,
    createdAt: now,
    updatedAt: now,
  };

  saveCase(newCase);
  return NextResponse.json(newCase, { status: 201 });
}
