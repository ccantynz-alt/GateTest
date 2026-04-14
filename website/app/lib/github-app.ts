/**
 * GitHub App authentication — shared by webhook and auto-fix routes.
 *
 * Two auth paths:
 *   1. Personal access token (GITHUB_TOKEN / GATETEST_GITHUB_TOKEN) — simplest, used when set.
 *   2. GitHub App installation token — minted on demand from the app's JWT.
 *
 * Env vars:
 *   GITHUB_TOKEN / GATETEST_GITHUB_TOKEN — optional PAT
 *   GATETEST_APP_ID                     — GitHub App ID
 *   GATETEST_PRIVATE_KEY                — .pem contents (escaped newlines ok)
 */

import https from "https";
import crypto from "crypto";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GATETEST_GITHUB_TOKEN || "";
const GATETEST_APP_ID = process.env.GATETEST_APP_ID || "";

export interface GithubApiResponse {
  status: number;
  data: Record<string, unknown>;
}

export function httpsJsonRequest(
  options: https.RequestOptions,
  body?: string
): Promise<GithubApiResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode || 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode || 0, data: { raw } });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

export async function githubApi(
  method: string,
  path: string,
  token: string,
  body?: Record<string, unknown>
): Promise<GithubApiResponse> {
  const payload = body ? JSON.stringify(body) : undefined;
  const headers: Record<string, string> = {
    "User-Agent": "GateTest/1.2.0",
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
  };
  if (payload) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(payload));
  }
  return httpsJsonRequest(
    { hostname: "api.github.com", port: 443, path, method, headers },
    payload
  );
}

// ── JWT / Installation Token ─────────────────────────

function getPrivateKey(): string {
  const key = process.env.GATETEST_PRIVATE_KEY || "";
  if (key.includes("BEGIN")) return key;
  return key.replace(/\\n/g, "\n");
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function createAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 10 * 60, iss: GATETEST_APP_ID })
  );
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), getPrivateKey());
  return `${header}.${payload}.${base64url(signature)}`;
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const jwt = createAppJwt();
  const res = await githubApi(
    "POST",
    `/app/installations/${installationId}/access_tokens`,
    jwt
  );
  if (res.status !== 201 || !res.data.token) {
    throw new Error(`Could not mint installation token (status ${res.status})`);
  }
  return res.data.token as string;
}

export type AuthSource = "pat" | "app";

export interface TokenResolution {
  token: string | null;
  source: AuthSource | null;
  error?: string;
}

/**
 * Resolve a GitHub token for a specific repo.
 *   1. If GITHUB_TOKEN is set, use it.
 *   2. Else use the GitHub App: look up the installation on the repo, mint a token.
 *   3. Else return null with a descriptive error.
 */
export async function resolveGithubToken(
  owner: string,
  repo: string
): Promise<TokenResolution> {
  if (GITHUB_TOKEN) {
    return { token: GITHUB_TOKEN, source: "pat" };
  }
  if (!GATETEST_APP_ID || !process.env.GATETEST_PRIVATE_KEY) {
    return { token: null, source: null };
  }
  try {
    const jwt = createAppJwt();
    const instRes = await githubApi("GET", `/repos/${owner}/${repo}/installation`, jwt);
    if (instRes.status !== 200) {
      return {
        token: null,
        source: null,
        error: `GitHub App not installed on ${owner}/${repo} (status ${instRes.status}). Install it at https://github.com/apps/gatetesthq`,
      };
    }
    const installationId = (instRes.data as { id?: number }).id;
    if (!installationId) {
      return { token: null, source: null, error: "No installation id in GitHub response" };
    }
    const token = await getInstallationToken(installationId);
    return { token, source: "app" };
  } catch (err) {
    return {
      token: null,
      source: null,
      error: `GitHub App auth failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}
