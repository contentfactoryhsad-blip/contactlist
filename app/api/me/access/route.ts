import { NextResponse } from "next/server";
import { listActiveAccess } from "@/lib/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("query") ?? "").trim().toLowerCase();
  if (!query) {
    return NextResponse.json({ records: [] });
  }

  const records = await listActiveAccess();
  const matches = records.filter((record) => {
    const name = (record.fields.Name ?? "").toLowerCase();
    const email = (record.fields.Email ?? "").toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  return NextResponse.json({ records: matches.slice(0, 50) });
}
