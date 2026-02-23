import { NextResponse } from "next/server";
import { getAdminSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getAdminSettings();
  return NextResponse.json({ centralAdminEmail: settings.centralAdminEmail });
}
