import { NextResponse } from "next/server";
import { listRequestsByEmail } from "@/lib/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const records = await listRequestsByEmail(email.trim().toLowerCase());
  return NextResponse.json({ records });
}
