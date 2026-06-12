export const DEFAULT_OPENING_GREETING = "よろしくお願いします";
export const DEFAULT_CLOSING_GREETING = "ありがとうございました。";

export const MAX_GREETING_LENGTH = 125;

export function resolveOpeningGreeting(profileValue: string | null | undefined): string {
  return profileValue ?? DEFAULT_OPENING_GREETING;
}

export function resolveClosingGreeting(profileValue: string | null | undefined): string {
  return profileValue ?? DEFAULT_CLOSING_GREETING;
}

export type GreetingValidationResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function validateGreeting(raw: unknown, fieldLabel: string): GreetingValidationResult {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, error: `${fieldLabel}の値が不正です` };
  }
  if (raw.length === 0) {
    return { ok: false, error: `${fieldLabel}は空欄では保存できません` };
  }
  if (raw.length > MAX_GREETING_LENGTH) {
    return { ok: false, error: `${fieldLabel}は${MAX_GREETING_LENGTH}文字以内で入力してください` };
  }
  if (/\n.*\n/.test(raw)) {
    return { ok: false, error: `${fieldLabel}は改行を 1 つまでしか使えません` };
  }
  return { ok: true, value: raw };
}
