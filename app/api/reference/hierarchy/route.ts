import { NextResponse } from "next/server";
import { getHierarchyRows } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await getHierarchyRows();
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to load reference hierarchy." },
      { status: 500 }
    );
  }
}
