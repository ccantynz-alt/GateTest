/**
 * GET /api/github/repos
 *
 * Lists all repos the authenticated user has connected to GateTest.
 * Requires the gatetest_token cookie from OAuth flow.
 */

import { NextRequest, NextResponse } from "next/server";
import https from "https";
import crypto from "crypto";

const APP_ID = process.env.GATETEST_APP_ID;

function getPrivateKey(): string {
  const key = process.env.GATETEST_PRIVATE_KEY || "";
  if (key.includes("BEGIN")) return key;
  return key.replace(/\\n/g, "\n");
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJWT(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 10 * 60, iss: APP_ID })
  );
  const signature = crypto.sign(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    getPrivateKey()
  );
  return `${header}.${payload}.${base64url(signature)}`;
}

function githubGet(
  path: string,
  token: string
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path,
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "GateTest-App/1.0.0",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            resolve({ error: "parse_failed" });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function githubPost(
  path: string,
  token: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "GateTest-App/1.0.0",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }

    const req = https.request(
      { hostname: "api.github.com", path, method: "POST", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            resolve({ error: "parse_failed" });
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function GET(req: NextRequest) {
  // Check auth
  const token = req.cookies.get("gatetest_token")?.value;
  if (!token) {
    return NextResponse.json(
      { error: "Not authenticated. Connect GitHub first." },
      { status: 401 }
    );
  }

  if (!APP_ID) {
    return NextResponse.json(
      { error: "GateTest App not configured" },
      { status: 500 }
    );
  }

  try {
    // Get the user's installations of our app
    const installations = (await githubGet(
      "/user/installations",
      token
    )) as { installations?: Array<{ id: number; account: { login: string; type: string }; repository_selection: string }> };

    if (!installations.installations || installations.installations.length === 0) {
      return NextResponse.json({
        connected: false,
        installations: [],
        repos: [],
        message: "No installations found. Install GateTest on your repos first.",
      });
    }

    // For each installation, get the repos
    const allRepos: Array<{
      name: string;
      full_name: string;
      private: boolean;
      language: string | null;
      installation_id: number;
      default_branch: string;
    }> = [];

    for (const inst of installations.installations) {
      // Get installation token
      const jwt = createJWT();
      const tokenResult = (await githubPost(
        `/app/installations/${inst.id}/access_tokens`,
        jwt
      )) as { token?: string };

      if (!tokenResult.token) continue;

      const repoResult = (await githubGet(
        "/installation/repositories?per_page=100",
        tokenResult.token
      )) as { repositories?: Array<{
        name: string;
        full_name: string;
        private: boolean;
        language: string | null;
        default_branch: string;
      }> };

      if (repoResult.repositories) {
        for (const repo of repoResult.repositories) {
          allRepos.push({
            name: repo.name,
            full_name: repo.full_name,
            private: repo.private,
            language: repo.language,
            installation_id: inst.id,
            default_branch: repo.default_branch,
          });
        }
      }
    }

    return NextResponse.json({
      connected: true,
      installations: installations.installations.map((i) => ({
        id: i.id,
        account: i.account.login,
        type: i.account.type,
        selection: i.repository_selection,
      })),
      repos: allRepos,
      total: allRepos.length,
    });
  } catch (err) {
    console.error("[GateTest] Repos API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch repos" },
      { status: 500 }
    );
  }
}
