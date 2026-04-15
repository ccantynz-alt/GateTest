/**
 * Infrastructure-as-code scan modules — #18 (iacSecurity) + #19 (ciHardening).
 *
 * iacSecurity:    Inspects Dockerfiles, Kubernetes manifests, and Terraform /
 *                 CloudFormation files for the classic misconfigurations that
 *                 make every audit and pentest report — :latest image tags,
 *                 privileged containers, 0.0.0.0/0 ingress, etc.
 *
 * ciHardening:    Inspects .github/workflows/*.yml for unpinned action
 *                 versions, missing `permissions:`, pull_request_target misuse,
 *                 and `secrets.*` leakage into untrusted jobs — the issues
 *                 that cause real CI-supply-chain incidents.
 *
 * Both modules are pure static analysis of ctx.fileContents — no YAML library
 * needed, no network, no shell. Works identically on Vercel and GlueCron.
 */
import type { ModuleContext, ModuleOutput, ModuleRunner, RepoFile } from "./types";

function lineNumber(content: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < content.length; i++) if (content[i] === "\n") n++;
  return n;
}

/* ------------------------------------------------------------------ */
/* iacSecurity — module #18                                            */
/* ------------------------------------------------------------------ */

function isDockerfile(p: string): boolean {
  const base = p.split("/").pop() || "";
  return /^Dockerfile($|\.)/i.test(base) || /\.dockerfile$/i.test(base);
}

function isKubernetesYaml(content: string, path: string): boolean {
  if (!/\.ya?ml$/i.test(path)) return false;
  return /^\s*apiVersion\s*:/m.test(content) && /^\s*kind\s*:/m.test(content);
}

function isTerraform(p: string): boolean {
  return /\.tf$/i.test(p);
}

function scanDockerfile(f: RepoFile, details: string[]): { checks: number; issues: number } {
  let checks = 0;
  let issues = 0;
  const lines = f.content.split("\n");

  lines.forEach((line, i) => {
    const ln = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    // FROM ... :latest OR FROM without an explicit tag.
    const fromMatch = trimmed.match(/^FROM\s+([^\s]+)/i);
    if (fromMatch) {
      checks++;
      const image = fromMatch[1];
      if (image === "scratch") {
        // fine
      } else if (image.endsWith(":latest")) {
        issues++;
        details.push(`${f.path}:${ln}: FROM uses :latest — pin to a specific digest or tag`);
      } else if (!image.includes(":") && !image.includes("@")) {
        issues++;
        details.push(`${f.path}:${ln}: FROM has no tag — defaults to :latest, pin an explicit version`);
      }
    }

    // Running as root — ADD USER root or missing USER entirely is handled below.
    if (/^USER\s+(root|0)\s*$/i.test(trimmed)) {
      checks++;
      issues++;
      details.push(`${f.path}:${ln}: USER root — drop to a non-root user for runtime`);
    }

    // ADD with URL — prefer COPY or RUN curl so integrity is visible.
    if (/^ADD\s+https?:\/\//i.test(trimmed)) {
      checks++;
      issues++;
      details.push(`${f.path}:${ln}: ADD from a URL — use RUN curl -f with --checksum or prefer COPY`);
    }

    // Secrets leaked via ENV or ARG.
    if (/^(ENV|ARG)\s+([A-Z_]*(KEY|SECRET|TOKEN|PASSWORD))\s*=/i.test(trimmed)) {
      checks++;
      issues++;
      details.push(`${f.path}:${ln}: ${trimmed.split(/\s/)[0]} sets a secret-looking var — use BuildKit --secret instead`);
    }

    // Insecure curl | sh bootstrap.
    if (/curl[^|]*\|\s*(sh|bash)/i.test(trimmed) || /wget[^|]*\|\s*(sh|bash)/i.test(trimmed)) {
      checks++;
      issues++;
      details.push(`${f.path}:${ln}: pipes remote script into shell — pin a checksum or vendor the script`);
    }
  });

  // Missing USER directive entirely → running as root by default.
  checks++;
  const hasNonRootUser = lines.some((l) =>
    /^\s*USER\s+(?!root\b)(?!0\b)\S+/i.test(l)
  );
  if (!hasNonRootUser) {
    issues++;
    details.push(`${f.path}: no non-root USER directive — container runs as root by default`);
  }

  return { checks, issues };
}

function scanKubernetes(f: RepoFile, details: string[]): { checks: number; issues: number } {
  let checks = 0;
  let issues = 0;
  const c = f.content;

  const rules: { name: string; re: RegExp; msg: string }[] = [
    { name: "privileged", re: /^\s*privileged\s*:\s*true\b/m, msg: "privileged: true — container has full host access" },
    { name: "hostNetwork", re: /^\s*hostNetwork\s*:\s*true\b/m, msg: "hostNetwork: true — pod shares host network stack" },
    { name: "hostPID", re: /^\s*hostPID\s*:\s*true\b/m, msg: "hostPID: true — pod shares host PID namespace" },
    { name: "runAsUser 0", re: /^\s*runAsUser\s*:\s*0\b/m, msg: "runAsUser: 0 — pod runs as root" },
    { name: "allowPrivilegeEscalation", re: /^\s*allowPrivilegeEscalation\s*:\s*true\b/m, msg: "allowPrivilegeEscalation: true — disable unless absolutely required" },
    { name: "capabilities ALL", re: /capabilities\s*:\s*\n\s*add\s*:\s*\n\s*-\s*ALL/m, msg: "capabilities.add: [ALL] — grants all Linux capabilities" },
    { name: ":latest image", re: /^\s*image\s*:\s*[^\s]+:latest\s*$/m, msg: "image uses :latest tag — pin a specific digest or tag" },
  ];

  for (const r of rules) {
    checks++;
    const m = r.re.exec(c);
    if (m) {
      issues++;
      details.push(`${f.path}:${lineNumber(c, m.index)}: ${r.msg}`);
    }
  }

  // Image without any tag at all.
  const noTag = /^\s*image\s*:\s*([^\s:]+)\s*$/m.exec(c);
  checks++;
  if (noTag) {
    issues++;
    details.push(
      `${f.path}:${lineNumber(c, noTag.index)}: image has no tag — defaults to :latest`
    );
  }
  return { checks, issues };
}

function scanTerraform(f: RepoFile, details: string[]): { checks: number; issues: number } {
  let checks = 0;
  let issues = 0;
  const c = f.content;

  const rules: { name: string; re: RegExp; msg: string }[] = [
    { name: "0.0.0.0/0 ingress", re: /cidr_blocks\s*=\s*\[\s*"0\.0\.0\.0\/0"\s*\]/, msg: "cidr_blocks open to the internet (0.0.0.0/0)" },
    { name: "S3 public-read", re: /acl\s*=\s*"public-read(?:-write)?"/, msg: "S3 ACL public-read — bucket is world-readable" },
    { name: "S3 no encryption", re: /resource\s+"aws_s3_bucket"[\s\S]*?\{[\s\S]*?\}/, msg: "" },
    { name: "hardcoded secret", re: /(access_key|secret_key|password)\s*=\s*"[A-Za-z0-9_\-]{12,}"/i, msg: "hardcoded credential in Terraform — move to a secrets manager" },
    { name: "unencrypted EBS", re: /resource\s+"aws_ebs_volume"[\s\S]*?encrypted\s*=\s*false/, msg: "EBS volume encrypted = false" },
  ];

  for (const r of rules) {
    if (!r.msg) continue;
    checks++;
    const m = r.re.exec(c);
    if (m) {
      issues++;
      details.push(`${f.path}:${lineNumber(c, m.index)}: ${r.msg}`);
    }
  }
  return { checks, issues };
}

export const iacSecurity: ModuleRunner = async (
  ctx: ModuleContext
): Promise<ModuleOutput> => {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;
  let inspected = 0;

  for (const f of ctx.fileContents) {
    if (isDockerfile(f.path)) {
      inspected++;
      const r = scanDockerfile(f, details);
      checks += r.checks;
      issues += r.issues;
      continue;
    }
    if (isKubernetesYaml(f.content, f.path)) {
      inspected++;
      const r = scanKubernetes(f, details);
      checks += r.checks;
      issues += r.issues;
      continue;
    }
    if (isTerraform(f.path)) {
      inspected++;
      const r = scanTerraform(f, details);
      checks += r.checks;
      issues += r.issues;
      continue;
    }
  }

  if (inspected === 0) {
    return {
      checks: 0,
      issues: 0,
      details: [],
      skipped: "no Dockerfile, Kubernetes manifest, or Terraform file found",
    };
  }
  return { checks, issues, details };
};

/* ------------------------------------------------------------------ */
/* ciHardening — module #19                                            */
/* ------------------------------------------------------------------ */

function isGithubWorkflow(p: string): boolean {
  return /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(p);
}

export const ciHardening: ModuleRunner = async (
  ctx: ModuleContext
): Promise<ModuleOutput> => {
  const workflows = ctx.fileContents.filter((f) => isGithubWorkflow(f.path));
  if (workflows.length === 0) {
    return {
      checks: 0,
      issues: 0,
      details: [],
      skipped: "no .github/workflows/*.yml files found",
    };
  }

  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  for (const f of workflows) {
    const c = f.content;

    // 1. pull_request_target — dangerous combined with checkout of PR head.
    checks++;
    if (/^\s*-?\s*pull_request_target\b/m.test(c) || /on\s*:\s*\{[^}]*pull_request_target/m.test(c)) {
      // combined with actions/checkout of PR HEAD is the real smell
      if (/actions\/checkout[\s\S]{0,400}ref:\s*\$\{\{\s*github\.event\.pull_request\.head/.test(c)) {
        issues++;
        details.push(
          `${f.path}: pull_request_target + checkout of PR head ref — classic pwn-request pattern`
        );
      } else {
        issues++;
        details.push(
          `${f.path}: uses pull_request_target — high-risk trigger, review permissions carefully`
        );
      }
    }

    // 2. Unpinned action versions (uses: actions/checkout@v4 vs @<40-char-sha>).
    const usesMatches = c.matchAll(/uses:\s*([^\s#]+)@([^\s#]+)/g);
    for (const m of usesMatches) {
      checks++;
      const ref = m[2];
      if (/^[0-9a-f]{40}$/i.test(ref)) continue; // pinned to a commit SHA
      if (ref === "main" || ref === "master" || ref === "HEAD") {
        issues++;
        details.push(
          `${f.path}:${lineNumber(c, m.index!)}: uses ${m[1]}@${ref} — pin to a commit SHA`
        );
      } else if (/^v?\d/.test(ref)) {
        // Tag like v4 / v4.1.2 — movable. Flag for hardening.
        issues++;
        details.push(
          `${f.path}:${lineNumber(c, m.index!)}: uses ${m[1]}@${ref} — tags are mutable, pin to a commit SHA`
        );
      }
    }

    // 3. Missing top-level permissions: — defaults to write-all on many setups.
    checks++;
    if (!/^\s*permissions\s*:/m.test(c)) {
      issues++;
      details.push(
        `${f.path}: no top-level permissions: — token defaults to broad scope, add \`permissions: read-all\``
      );
    }

    // 4. ${{ secrets.* }} referenced inside a script that also runs untrusted
    //    input — cheap heuristic: secrets used in same step as github.event.*.
    checks++;
    if (/run:[\s\S]*?secrets\./m.test(c) && /run:[\s\S]*?github\.event\.[a-z_]+\./m.test(c)) {
      issues++;
      details.push(
        `${f.path}: a run: step references both secrets.* and github.event.* — untrusted input can exfiltrate the secret`
      );
    }

    // 5. curl | sh bootstrap in CI.
    const pipe = /curl[^|\n]*\|\s*(sh|bash)|wget[^|\n]*\|\s*(sh|bash)/.exec(c);
    checks++;
    if (pipe) {
      issues++;
      details.push(
        `${f.path}:${lineNumber(c, pipe.index)}: pipes remote script into shell — pin a checksum or vendor the installer`
      );
    }
  }

  return { checks, issues, details };
};
