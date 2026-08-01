import { NextResponse } from "next/server";
import { getEventState } from "../../../lib/store";
export async function GET() { try { return NextResponse.json(await getEventState()); } catch { return NextResponse.json({ error: "Aktuelle Daten konnten nicht geladen werden." }, { status: 500 }); } }
