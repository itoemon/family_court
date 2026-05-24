export type Role = "plaintiff" | "defendant";

export type JudgeTrigger = "opening" | "turn" | "closing";

export interface JudgeMessage {
  id: string;
  content: string;
  triggerType: JudgeTrigger;
  createdAt: string;
}

export type Phase =
  | "waiting"      // 被告の参加待ち
  | "opening"      // 冒頭陳述
  | "argument"     // 主張・反論
  | "closing"      // 最終弁論
  | "judging"      // AI審議中
  | "verdict";     // 判決済み

export interface Argument {
  id: string;
  role: Role;
  phase: Phase;
  round: number;
  content: string;
  createdAt: string;
}

export interface Player {
  name: string;
  joinedAt: string;
}

export interface Case {
  id: string;
  topic: string;
  defendantId: string | null;
  callerRole?: "plaintiff" | "defendant" | "observer";
  plaintiff: Player | null;
  defendant: Player | null;
  arguments: Argument[];
  judgeMessages: JudgeMessage[];
  phase: Phase;
  currentTurn: Role;
  round: number;
  maxRounds: number;
  verdict: Verdict | null;
  createdAt: string;
  updatedAt: string;
}

export interface Verdict {
  winner: Role | "draw";
  summary: string;
  reasoning: string;
  plaintiffScore: number;
  defendantScore: number;
  decidedAt: string;
}

export interface CreateCaseRequest {
  topic: string;
  plaintiffName: string;
  maxRounds?: number;
}

export interface JoinCaseRequest {
  defendantName: string;
}

export interface AddArgumentRequest {
  content: string;
}
