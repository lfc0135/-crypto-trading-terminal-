import { NextResponse } from "next/server";

export const routeConfig = {
  dynamic: "force-dynamic" as const,
  runtime: "nodejs" as const,
};

export async function handle(fn: () => Promise<unknown>, statusOnError = 400) {
  try {
    return NextResponse.json(await fn());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    return NextResponse.json({ error: message }, { status: statusOnError });
  }
}
