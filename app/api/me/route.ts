import { NextResponse } from "next/server";
import { getPersonalVote } from "../../../lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: unknown };
    if (typeof body.token !== "string") return NextResponse.json({ error: "Sitzung fehlt." }, { status: 400 });
    return NextResponse.json({ user: await getPersonalVote(body.token) });
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION") return NextResponse.json({ error: "Deine Sitzung ist nicht mehr gültig. Bitte erneut anmelden." }, { status: 401 });
    return NextResponse.json({ error: "Deine gespeicherte Stimme konnte nicht geladen werden." }, { status: 500 });
  }
}
