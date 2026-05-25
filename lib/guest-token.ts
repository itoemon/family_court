import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";

const GUEST_TOKEN_SECRET: string = (() => {
  const secret = process.env.GUEST_TOKEN_SECRET;
  if (!secret) throw new Error("GUEST_TOKEN_SECRET is not set");
  return secret;
})();

export async function generateGuestToken(caseId: string): Promise<string> {
  const nonce = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto
    .createHmac("sha256", GUEST_TOKEN_SECRET)
    .update(nonce)
    .digest("hex");

  const admin = createAdminClient();
  const { error } = await admin.from("guest_tokens").insert({
    case_id: caseId,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(`guest_tokens INSERT failed: ${error.message}`);

  return nonce;
}

export async function verifyGuestToken(caseId: string, token: string): Promise<boolean> {
  const tokenHash = crypto
    .createHmac("sha256", GUEST_TOKEN_SECRET)
    .update(token)
    .digest("hex");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("guest_tokens")
    .select("id")
    .eq("case_id", caseId)
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .is("revoked_at", null)
    .limit(1);

  if (error) throw new Error(`guest_tokens SELECT failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}
