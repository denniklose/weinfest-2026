import { neon } from "@neondatabase/serverless";
import { createHash, randomBytes, randomUUID } from "crypto";

export type Participant = { id: string; name: string; normalizedName: string; wineNumber: number; tokenHash: string; vote?: number; updatedAt: string };
type MoodVote = { voterTokenHash: string; selectedParticipantId: string; updatedAt: string };
type HostContent = { rules: string; wineLeaderboardEnabled: boolean };

const defaultRules = `1. Melde dich mit deinem Namen und deiner Wein-Nummer an.\n2. Probiere die Weine in deinem Tempo und entdecke deinen Favoriten.\n3. Stimme für einen Wein – nur nicht für deinen eigenen.\n4. Du kannst deine Wahl bis zum Ende der Abstimmung ändern.\n5. Am Schluss küren wir gemeinsam den Gewinnerwein.`;
const memory = globalThis as typeof globalThis & { __weinfestMemory?: { participants: Map<string, Participant>; moods: Map<string, MoodVote>; host: HostContent } };
const fallback = memory.__weinfestMemory ?? { participants: new Map<string, Participant>(), moods: new Map<string, MoodVote>(), host: { rules: defaultRules, wineLeaderboardEnabled: false } };
memory.__weinfestMemory = fallback;

const databaseUrl = process.env.DATABASE_URL;
const sql = databaseUrl ? neon(databaseUrl) : null;
let schemaReady: Promise<void> | undefined;

export function normalizeName(value: string) { return value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE"); }
export function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function newToken() { return randomBytes(32).toString("hex"); }

async function ready() {
  if (!sql) return;
  schemaReady ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS participants (id text primary key, name text not null, normalized_name text unique not null, wine_number integer unique not null check (wine_number between 1 and 30), token_hash text unique not null, vote integer, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`;
    await sql`CREATE TABLE IF NOT EXISTS mood_votes (voter_token_hash text primary key, selected_participant_id text not null references participants(id) on delete cascade, updated_at timestamptz not null default now())`;
    await sql`CREATE TABLE IF NOT EXISTS event_content (id boolean primary key default true, rules text not null, wine_leaderboard_enabled boolean not null default false, updated_at timestamptz not null default now())`;
    await sql`INSERT INTO event_content (id, rules) VALUES (true, ${defaultRules}) ON CONFLICT (id) DO NOTHING`;
  })();
  await schemaReady;
}

export async function registerParticipant(name: string, wineNumber: number) {
  const normalizedName = normalizeName(name); const token = newToken(); const participant: Participant = { id: randomUUID(), name, normalizedName, wineNumber, tokenHash: hash(token), updatedAt: new Date().toISOString() };
  if (!sql) {
    if ([...fallback.participants.values()].some(p => p.normalizedName === normalizedName)) throw new Error("NAME_TAKEN");
    if ([...fallback.participants.values()].some(p => p.wineNumber === wineNumber)) throw new Error("NUMBER_TAKEN");
    fallback.participants.set(participant.id, participant); return { user: { name, wineNumber, token } };
  }
  await ready();
  try { await sql`INSERT INTO participants (id, name, normalized_name, wine_number, token_hash) VALUES (${participant.id}, ${name}, ${normalizedName}, ${wineNumber}, ${participant.tokenHash})`; }
  catch (error) { const text = error instanceof Error ? error.message : ""; if (text.includes("normalized_name")) throw new Error("NAME_TAKEN"); if (text.includes("wine_number")) throw new Error("NUMBER_TAKEN"); throw error; }
  return { user: { name, wineNumber, token } };
}

export async function saveWineVote(token: string, selectedWineNumber: number) {
  const tokenHash = hash(token);
  if (!sql) { const participant = [...fallback.participants.values()].find(p => p.tokenHash === tokenHash); if (!participant) throw new Error("SESSION"); if (participant.wineNumber === selectedWineNumber) throw new Error("SELF"); participant.vote = selectedWineNumber; participant.updatedAt = new Date().toISOString(); return { selectedWineNumber, savedAt: participant.updatedAt }; }
  await ready(); const rows = await sql`SELECT id, wine_number FROM participants WHERE token_hash = ${tokenHash} LIMIT 1`; const participant = rows[0] as { id: string; wine_number: number } | undefined;
  if (!participant) throw new Error("SESSION"); if (participant.wine_number === selectedWineNumber) throw new Error("SELF");
  await sql`UPDATE participants SET vote = ${selectedWineNumber}, updated_at = now() WHERE id = ${participant.id}`;
  return { selectedWineNumber, savedAt: new Date().toISOString() };
}

export async function getPersonalVote(token: string) {
  const tokenHash = hash(token);
  if (!sql) {
    const participant = [...fallback.participants.values()].find(p => p.tokenHash === tokenHash);
    if (!participant) throw new Error("SESSION");
    return { name: participant.name, wineNumber: participant.wineNumber, selectedWineNumber: participant.vote ?? null };
  }
  await ready();
  const rows = await sql`SELECT name, wine_number, vote FROM participants WHERE token_hash = ${tokenHash} LIMIT 1`;
  const participant = rows[0] as { name: string; wine_number: number; vote: number | null } | undefined;
  if (!participant) throw new Error("SESSION");
  return { name: participant.name, wineNumber: participant.wine_number, selectedWineNumber: participant.vote ?? null };
}

export async function getEventState() {
  if (!sql) return stateFromMemory();
  await ready(); const [people, content, moods, wines] = await Promise.all([
    sql`SELECT id, name, wine_number FROM participants ORDER BY created_at ASC`, sql`SELECT rules, wine_leaderboard_enabled FROM event_content WHERE id = true`,
    sql`SELECT selected_participant_id, count(*)::int AS count FROM mood_votes GROUP BY selected_participant_id ORDER BY count DESC`, sql`SELECT vote, count(*)::int AS count FROM participants WHERE vote IS NOT NULL GROUP BY vote ORDER BY count DESC`
  ]);
  const row = content[0] as { rules: string; wine_leaderboard_enabled: boolean } | undefined;
  return { participants: people.map(p => ({ id: String(p.id), name: String(p.name), wineNumber: Number(p.wine_number) })), moodLeaderboard: moods.map(m => ({ votes: Number(m.count) })), wineLeaderboard: row?.wine_leaderboard_enabled ? wines.map(w => ({ votes: Number(w.count) })) : [], host: { rules: row?.rules ?? defaultRules, wineLeaderboardEnabled: row?.wine_leaderboard_enabled ?? false }, durable: true };
}

function stateFromMemory() {
  const people = [...fallback.participants.values()]; const moodCounts = new Map<string, number>(); const wineCounts = new Map<number, number>();
  fallback.moods.forEach(vote => moodCounts.set(vote.selectedParticipantId, (moodCounts.get(vote.selectedParticipantId) ?? 0) + 1)); people.forEach(p => { if (p.vote) wineCounts.set(p.vote, (wineCounts.get(p.vote) ?? 0) + 1); });
  return { participants: people.map(p => ({ id: p.id, name: p.name, wineNumber: p.wineNumber })), moodLeaderboard: [...moodCounts.values()].sort((a, b) => b - a).map(votes => ({ votes })), wineLeaderboard: fallback.host.wineLeaderboardEnabled ? [...wineCounts.values()].sort((a, b) => b - a).map(votes => ({ votes })) : [], host: fallback.host, durable: false };
}

export async function saveMoodVote(token: string, participantId: string) {
  const tokenHash = hash(token);
  if (!sql) { if (![...fallback.participants.values()].some(p => p.tokenHash === tokenHash)) throw new Error("SESSION"); if (!fallback.participants.has(participantId)) throw new Error("PERSON"); fallback.moods.set(tokenHash, { voterTokenHash: tokenHash, selectedParticipantId: participantId, updatedAt: new Date().toISOString() }); return; }
  await ready(); const [voter, person] = await Promise.all([sql`SELECT id FROM participants WHERE token_hash = ${tokenHash} LIMIT 1`, sql`SELECT id FROM participants WHERE id = ${participantId} LIMIT 1`]); if (!voter[0]) throw new Error("SESSION"); if (!person[0]) throw new Error("PERSON"); await sql`INSERT INTO mood_votes (voter_token_hash, selected_participant_id) VALUES (${tokenHash}, ${participantId}) ON CONFLICT (voter_token_hash) DO UPDATE SET selected_participant_id = EXCLUDED.selected_participant_id, updated_at = now()`;
}

export async function saveHostRules(code: string, rules: string) {
  if (!process.env.HOST_EDIT_CODE || code !== process.env.HOST_EDIT_CODE) throw new Error("HOST_AUTH"); if (rules.trim().length < 20 || rules.length > 4000) throw new Error("RULES");
  if (!sql) { fallback.host.rules = rules.trim(); return; } await ready(); await sql`UPDATE event_content SET rules = ${rules.trim()}, updated_at = now() WHERE id = true`;
}

export const isDurableStoreConfigured = Boolean(databaseUrl);
