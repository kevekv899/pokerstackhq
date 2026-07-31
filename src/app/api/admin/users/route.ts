import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { getAdminUsers, isAdminUserSort } from "@/lib/admin-db";

/**
 * Users table. Search matches username or email; sort is restricted to a known
 * column set so the value can never reach the query as arbitrary SQL.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = req.nextUrl.searchParams;
    const search = params.get("search") ?? "";
    const sortParam = params.get("sort") ?? "id";
    const dirParam = params.get("dir") === "desc" ? "desc" : "asc";

    const sort = isAdminUserSort(sortParam) ? sortParam : "id";
    const users = await getAdminUsers(search, sort, dirParam);

    return NextResponse.json({ users, sort, dir: dirParam });
  } catch (err) {
    console.error("admin/users failed:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
