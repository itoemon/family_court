import { createHmac, timingSafeEqual } from "node:crypto";

function computeToken(caseId: string): string {
  return createHmac("sha256", process.env.GUEST_TOKEN_SECRET!)
    .update(`${caseId}:defendant`)
    .digest("hex");
}

export function generateGuestToken(caseId: string): string {
  return computeToken(caseId);
}

export function verifyGuestToken(caseId: string, token: string): boolean {
  const expected = computeToken(caseId);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(token, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
