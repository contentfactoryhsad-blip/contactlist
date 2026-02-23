import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "Auth not enabled." }, { status: 404 });
}

export async function POST() {
  return NextResponse.json({ error: "Auth not enabled." }, { status: 404 });
}
