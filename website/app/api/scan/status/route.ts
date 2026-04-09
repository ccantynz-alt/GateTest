/**
 * Scan Status API — Tracks and serves real-time scan progress.
 *
 * GET /api/scan/status?id=<scanId> — Returns current scan state
 * POST /api/scan/status — Updates scan state (internal use)
 *
 * Scan states flow: pending → cloning → scanning → complete/failed
 * Each module reports its progress as it runs.
 */

import { NextRequest, NextResponse } from "next/server";

// In-memory scan store (replaced with database later)
// For Vercel serverless, this persists within a single instance lifetime
const scanStore = new Map<string, ScanState>();

interface ModuleProgress {
  name: string;
  status: "pending" | "running" | "passed" | "failed" | "warning";
  checks?: number;
  issues?: number;
  duration?: number;
  message?: string;
}

interface ScanState {
  id: string;
  repoUrl: string;
  tier: string;
  status: "pending" | "cloning" | "scanning" | "fixing" | "complete" | "failed";
  progress: number; // 0-100
  currentModule: string | null;
  modules: ModuleProgress[];
  totalModules: number;
  completedModules: number;
  totalIssues: number;
  totalFixed: number;
  startedAt: string;
  completedAt: string | null;
  reportUrl: string | null;
  error: string | null;
}

// GET — client polls this for live updates
export async function GET(req: NextRequest) {
  const scanId = req.nextUrl.searchParams.get("id");

  if (!scanId) {
    return NextResponse.json({ error: "Missing scan id" }, { status: 400 });
  }

  const scan = scanStore.get(scanId);

  if (!scan) {
    // Return a "pending" state for scans we haven't seen yet
    // (the scan may be starting on another instance)
    return NextResponse.json({
      id: scanId,
      status: "pending",
      progress: 0,
      currentModule: null,
      modules: [],
      totalModules: 0,
      completedModules: 0,
      totalIssues: 0,
      totalFixed: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      reportUrl: null,
      error: null,
    });
  }

  return NextResponse.json(scan);
}

// POST — internal: scan runner updates progress here
export async function POST(req: NextRequest) {
  try {
    const update = await req.json() as Partial<ScanState> & { id: string };

    if (!update.id) {
      return NextResponse.json({ error: "Missing scan id" }, { status: 400 });
    }

    const existing = scanStore.get(update.id);
    if (existing) {
      Object.assign(existing, update);
      scanStore.set(update.id, existing);
    } else {
      scanStore.set(update.id, update as ScanState);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
