export type Role = "plaintiff" | "defendant";

export type JudgeTrigger = "opening" | "turn" | "closing";

export interface JudgeMessage {
  id: string;
  content: string;
  triggerType: JudgeTrigger;
  createdAt: string;
}

export type Phase =
  | "waiting"          // 被告の参加待ち
  | "opening"          // 冒頭陳述
  | "argument"         // 主張・反論
  | "closing"          // 最終弁論
  | "extension_voting" // 延長投票（両者が続行 / 終了を選択）
  | "judging"          // AI審議中
  | "verdict";         // 判決済み

export type EndProposalActor = "plaintiff" | "defendant" | "guest";
export type ExtensionVote = "continue" | "finish";

export interface Argument {
  id: string;
  role: Role;
  phase: Phase;
  round: number;
  content: string;
  isGreeting: boolean;
  createdAt: string;
}

export interface Player {
  name: string;
  joinedAt: string;
}

export interface ContradictionWarning {
  id: string;
  argumentId: string;
  message: string;
  createdAt: string;
}

export interface Case {
  id: string;
  topic: string;
  callerRole?: "plaintiff" | "defendant" | "observer";
  plaintiff: Player | null;
  defendant: Player | null;
  arguments: Argument[];
  judgeMessages: JudgeMessage[];
  contradictionWarnings: ContradictionWarning[];
  phase: Phase;
  currentTurn: Role;
  round: number;
  maxRounds: number;
  endProposedBy: EndProposalActor | null;
  extensionVotePlaintiff: ExtensionVote | null;
  extensionVoteDefendant: ExtensionVote | null;
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
}

export interface JoinCaseRequest {
  defendantName: string;
}

export interface AddArgumentRequest {
  content: string;
}

export type HistoryCase = {
  id: string;
  topic: string;
  phase: "verdict";
  createdAt: string;
  opponentName: string;
};

export interface DefenseMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Profile {
  id: string;
  display_name: string;
  api_key_encrypted: string | null;
  avatar_url: string | null;
  defense_custom_instruction: string | null;
  opening_greeting: string | null;
  closing_greeting: string | null;
  created_at: string;
  updated_at: string;
}

export type FriendRequest = {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
};

export type FriendProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

export type FriendListItem = {
  request_id: string;
  friend: FriendProfile;
};

export type IncomingRequest = {
  id: string;
  sender: FriendProfile;
  created_at: string;
};

export type ProposalType = 'amendment' | 'deletion';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected';

export interface Law {
  id: string;
  name: string;
  article: string;
  owner_id: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

// Hub 一覧のレスポンス境界型。owner_id を持たないことで個人識別子の漏洩を型レベルでも防ぐ。
export interface PublicLawListItem {
  id: string;
  name: string;
  article: string;
  owner_display_name: string;
  created_at: string;
}

export interface LawMember {
  id: string;
  law_id: string;
  user_id: string;
  joined_at: string;
}

export interface LawInvitation {
  id: string;
  law_id: string;
  invitee_id: string;
  status: InvitationStatus;
  invited_at: string;
}

export interface LawProposal {
  id: string;
  law_id: string;
  proposal_type: ProposalType;
  proposed_by: string;
  proposed_article: string | null;
  created_at: string;
}

export interface LawProposalVote {
  id: string;
  proposal_id: string;
  user_id: string;
  approved: boolean;
  voted_at: string;
}
