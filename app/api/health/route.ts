import { NextResponse } from "next/server";
import { isDurableStoreConfigured } from "../../../lib/store";
export async function GET() { return NextResponse.json({ ok: true, app: "weinfest-2026", database: isDurableStoreConfigured ? "neon-postgres" : "demo-memory", checkedAt: new Date().toISOString() }); }
