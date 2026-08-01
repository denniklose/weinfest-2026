import { NextResponse } from "next/server";
import { registerParticipant } from "../../../lib/store";

export async function POST(request: Request) {
  try { const body = await request.json() as { name?: unknown; wineNumber?: unknown }; const name = typeof body.name === "string" ? body.name.trim() : ""; const wineNumber = Number(body.wineNumber); if (name.length < 2 || name.length > 50 || !Number.isInteger(wineNumber) || wineNumber < 1 || wineNumber > 30) return NextResponse.json({ error: "Bitte gib einen gültigen Namen und eine Nummer von 1 bis 30 ein." }, { status: 400 }); return NextResponse.json(await registerParticipant(name, wineNumber), { status: 201 }); }
  catch (error) { if (error instanceof Error && error.message === "NAME_TAKEN") return NextResponse.json({ error: "Dieser Name wurde bereits verwendet. Prüfe bitte deine Eingabe." }, { status: 409 }); if (error instanceof Error && error.message === "NUMBER_TAKEN") return NextResponse.json({ error: "Diese Wein-Nummer wurde bereits verwendet. Prüfe bitte dein Namensschild." }, { status: 409 }); return NextResponse.json({ error: "Der Zugang konnte nicht geöffnet werden." }, { status: 500 }); }
}
