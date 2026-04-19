/**
 * GitHub webhook endpoint — DEPRECATED (410 Gone).
 *
 * GateTest has migrated off the GitHub App integration and now receives
 * push / PR events from Gluecron via the Signal Bus endpoint at
 * `/api/events/push`. This route exists only to return a clear 410 for
 * any stale webhook deliveries GitHub may still attempt — closing the
 * attack surface that the old handler represented (Bible Forbidden #15,
 * Known Issue #8 resolution).
 *
 * All GitHub App auth code, JWT minting, and repo-scan logic has been
 * removed from this file. The scan path lives at `/api/scan/run`; the
 * event ingress lives at `/api/events/push`.
 */

import { NextResponse } from "next/server";

const GONE_BODY = {
  error: "Endpoint deprecated",
  message:
    "GateTest no longer accepts GitHub webhooks. Push / PR events now land at /api/events/push via Gluecron. " +
    "If you are seeing this, uninstall the legacy GitHub App at https://github.com/settings/installations and " +
    "install GateTest on Gluecron instead.",
  migration: {
    newEndpoint: "/api/events/push",
    host: "gluecron",
    since: "2026-04-19",
  },
} as const;

// Every HTTP verb that GitHub's delivery agent might retry with — all
// return 410 so the delivery is marked failed and GitHub eventually
// disables the hook on their side.
export async function POST() {
  return NextResponse.json(GONE_BODY, { status: 410 });
}

export async function PUT() {
  return NextResponse.json(GONE_BODY, { status: 410 });
}

export async function PATCH() {
  return NextResponse.json(GONE_BODY, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json(GONE_BODY, { status: 410 });
}

// Keep a GET health shim so ops dashboards that probed the old webhook
// endpoint see an explicit deprecation rather than a 404 mystery.
export async function GET() {
  return NextResponse.json({
    status: "gone",
    app: "GateTest",
    deprecated: true,
    replacement: "/api/events/push",
    message:
      "This endpoint has been deprecated as part of the Gluecron migration. See /api/events/push.",
  }, { status: 410 });
}
