import { Case } from "./types";

// In-memory store for prototype. Data resets on server restart.
const cases = new Map<string, Case>();

export function getCase(id: string): Case | undefined {
  return cases.get(id);
}

export function saveCase(c: Case): void {
  cases.set(c.id, c);
}

export function getAllCases(): Case[] {
  return Array.from(cases.values());
}
