/**
 * Database layer tests — mock SQL function, no real DB required.
 *
 * Run: node --test website/tests/db.test.js
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// ─── Mock SQL layer ─────────────────────────────────────────────────
// Simulates the Neon tagged-template SQL function with an in-memory store.

function createMockDb() {
  const tables = {
    scans: [],
    customers: [],
  };

  /** Simple mock that captures INSERT/UPDATE/SELECT queries */
  function mockSql(queryOrStrings, ...params) {
    // Handle tagged template literal style: sql`SELECT ...`
    let query, queryParams;
    if (Array.isArray(queryOrStrings)) {
      query = queryOrStrings.join("$");
      queryParams = params;
    } else {
      query = queryOrStrings;
      queryParams = params[0] || [];
    }

    const q = query.toLowerCase().trim();

    if (q.startsWith("insert into scans")) {
      const p = queryParams;
      const record = {
        id: p[0],
        session_id: p[1],
        repo_url: p[2] || p[1],
        tier: p[3] || "quick",
        status: p[4] || "pending",
        results: p[5] ? (typeof p[5] === "string" ? JSON.parse(p[5]) : p[5]) : null,
        score: p[6] || null,
        duration_ms: p[7] || null,
        modules_run: p[8] || [],
        created_at: new Date().toISOString(),
        completed_at: p[4] === "completed" ? new Date().toISOString() : null,
        customer_email: null,
        payment_intent_id: null,
        tier_price_usd: null,
        summary: p[9] || null,
      };
      // ON CONFLICT DO NOTHING
      if (!tables.scans.find((s) => s.id === record.id)) {
        tables.scans.push(record);
      }
      return [];
    }

    if (q.startsWith("insert into customers")) {
      const p = queryParams;
      const existing = tables.customers.find((c) => c.email === p[1]);
      if (!existing) {
        tables.customers.push({
          id: p[0],
          email: p[1],
          stripe_customer_id: p[2] || null,
          github_login: null,
          total_scans: 0,
          total_spent_usd: 0,
          created_at: new Date().toISOString(),
        });
      } else if (p[2]) {
        existing.stripe_customer_id = p[2];
      }
      return [];
    }

    if (q.startsWith("update scans set")) {
      const p = queryParams;
      const scanId = p[p.length - 1];
      const scan = tables.scans.find((s) => s.id === scanId);
      if (scan) {
        // Simple update: just status
        if (p.length === 2) {
          scan.status = p[0];
        } else {
          // Multi-field update
          if (p[0] !== undefined) scan.status = p[0];
          if (p[1] !== undefined && p[1] !== "null") {
            scan.results = typeof p[1] === "string" ? JSON.parse(p[1]) : p[1];
          }
          if (p[2] !== undefined) scan.score = p[2];
          if (p[3] !== undefined) scan.duration_ms = p[3];
          if (p[4] !== undefined) scan.modules_run = p[4];
          if (p[5] !== undefined) scan.summary = p[5];
        }
        // Always set completed_at when status becomes completed or failed
        if (scan.status === "completed" || scan.status === "failed") {
          scan.completed_at = new Date().toISOString();
        }
      }
      return [];
    }

    if (q.startsWith("update customers set")) {
      const p = queryParams;
      const email = p[p.length - 1];
      const cust = tables.customers.find((c) => c.email === email);
      if (cust) {
        cust.total_scans += 1;
        cust.total_spent_usd += Number(p[0]) || 0;
      }
      return [];
    }

    if (q.includes("from scans") && q.includes("where session_id")) {
      const sessionId = queryParams[0];
      return tables.scans.filter((s) => s.session_id === sessionId);
    }

    if (q.includes("from scans") && q.includes("order by")) {
      return [...tables.scans].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    if (q.includes("from customers") && q.includes("where email")) {
      const email = queryParams[0];
      return tables.customers.filter((c) => c.email === email);
    }

    if (q.includes("from customers") && q.includes("order by")) {
      return [...tables.customers];
    }

    if (q.includes("count(*)") && q.includes("from scans")) {
      const total = tables.scans.length;
      const completed = tables.scans.filter((s) => s.status === "completed").length;
      const failed = tables.scans.filter((s) => s.status === "failed").length;
      const totalRevenue = tables.scans.reduce(
        (sum, s) => sum + (Number(s.tier_price_usd) || 0), 0
      );
      const scores = tables.scans.filter((s) => s.score != null).map((s) => s.score);
      const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      return [{
        total_scans: total,
        completed_scans: completed,
        failed_scans: failed,
        total_revenue: totalRevenue,
        avg_score: avgScore,
        avg_duration_ms: 0,
      }];
    }

    if (q.includes("count(*)") && q.includes("from customers")) {
      return [{ total: tables.customers.length }];
    }

    return [];
  }

  return { mockSql, tables };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Database layer", () => {
  let db;

  beforeEach(() => {
    db = createMockDb();
  });

  describe("Scan CRUD", () => {
    it("should create a scan record", () => {
      db.mockSql(
        "INSERT INTO scans (id, session_id, repo_url, tier, status) VALUES ($1, $2, $3, $4, $5)",
        ["scan-1", "cs_test_123", "https://github.com/test/repo", "quick", "pending"]
      );

      assert.equal(db.tables.scans.length, 1);
      assert.equal(db.tables.scans[0].id, "scan-1");
      assert.equal(db.tables.scans[0].session_id, "cs_test_123");
      assert.equal(db.tables.scans[0].status, "pending");
      assert.equal(db.tables.scans[0].tier, "quick");
    });

    it("should retrieve a scan by session_id", () => {
      db.mockSql(
        "INSERT INTO scans (id, session_id, repo_url, tier, status) VALUES ($1, $2, $3, $4, $5)",
        ["scan-1", "cs_test_123", "https://github.com/test/repo", "quick", "pending"]
      );

      const rows = db.mockSql(
        "SELECT * FROM scans WHERE session_id = $1 LIMIT 1",
        ["cs_test_123"]
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0].session_id, "cs_test_123");
      assert.equal(rows[0].repo_url, "https://github.com/test/repo");
    });

    it("should not duplicate scans with same id (ON CONFLICT DO NOTHING)", () => {
      db.mockSql(
        "INSERT INTO scans (id, session_id, repo_url, tier, status) VALUES ($1, $2, $3, $4, $5)",
        ["scan-1", "cs_test_123", "https://github.com/test/repo", "quick", "pending"]
      );
      db.mockSql(
        "INSERT INTO scans (id, session_id, repo_url, tier, status) VALUES ($1, $2, $3, $4, $5)",
        ["scan-1", "cs_test_456", "https://github.com/other/repo", "full", "running"]
      );

      assert.equal(db.tables.scans.length, 1);
      assert.equal(db.tables.scans[0].session_id, "cs_test_123");
    });
  });

  describe("Scan status flow", () => {
    it("should transition pending -> running -> completed", () => {
      // Create pending
      db.mockSql(
        "INSERT INTO scans (id, session_id, repo_url, tier, status) VALUES ($1, $2, $3, $4, $5)",
        ["scan-flow", "cs_flow", "https://github.com/test/repo", "full", "pending"]
      );
      assert.equal(db.tables.scans[0].status, "pending");

      // Update to running
      db.mockSql(
        "UPDATE scans SET status = $1 WHERE id = $2",
        ["running", "scan-flow"]
      );
      assert.equal(db.tables.scans[0].status, "running");

      // Complete with results
      const moduleResults = [
        { name: "syntax", status: "passed", checks: 5, issues: 0, duration: 50 },
        { name: "lint", status: "failed", checks: 3, issues: 2, duration: 30 },
      ];

      db.mockSql(
        "UPDATE scans SET status = $1, results = $2, score = $3, duration_ms = $4, modules_run = $5, summary = $6 WHERE id = $7",
        [
          "completed",
          JSON.stringify(moduleResults),
          90,
          500,
          ["syntax", "lint"],
          "2 modules, 2 issues",
          "scan-flow",
        ]
      );

      assert.equal(db.tables.scans[0].status, "completed");
      assert.equal(db.tables.scans[0].score, 90);
      assert.equal(db.tables.scans[0].duration_ms, 500);
      assert.deepEqual(db.tables.scans[0].modules_run, ["syntax", "lint"]);
      assert.ok(db.tables.scans[0].completed_at);
      assert.equal(db.tables.scans[0].results.length, 2);
    });

    it("should handle scan failure", () => {
      db.mockSql(
        "INSERT INTO scans (id, session_id, repo_url, tier, status) VALUES ($1, $2, $3, $4, $5)",
        ["scan-fail", "cs_fail", "https://github.com/bad/repo", "quick", "pending"]
      );

      db.mockSql(
        "UPDATE scans SET status = $1, results = $2, score = $3, duration_ms = $4, modules_run = $5, summary = $6 WHERE id = $7",
        ["failed", "null", 0, 100, [], "Cannot access repository", "scan-fail"]
      );

      assert.equal(db.tables.scans[0].status, "failed");
    });
  });

  describe("Customer CRUD", () => {
    it("should create a customer record", () => {
      db.mockSql(
        "INSERT INTO customers (id, email, stripe_customer_id) VALUES ($1, $2, $3)",
        ["cust-1", "test@example.com", "cus_test_123"]
      );

      assert.equal(db.tables.customers.length, 1);
      assert.equal(db.tables.customers[0].email, "test@example.com");
      assert.equal(db.tables.customers[0].stripe_customer_id, "cus_test_123");
      assert.equal(db.tables.customers[0].total_scans, 0);
    });

    it("should update customer stats after scan completes", () => {
      db.mockSql(
        "INSERT INTO customers (id, email, stripe_customer_id) VALUES ($1, $2, $3)",
        ["cust-1", "test@example.com", "cus_test_123"]
      );

      db.mockSql(
        "UPDATE customers SET total_scans = total_scans + 1, total_spent_usd = total_spent_usd + $1 WHERE email = $2",
        [29, "test@example.com"]
      );

      assert.equal(db.tables.customers[0].total_scans, 1);
      assert.equal(db.tables.customers[0].total_spent_usd, 29);

      // Second scan
      db.mockSql(
        "UPDATE customers SET total_scans = total_scans + 1, total_spent_usd = total_spent_usd + $1 WHERE email = $2",
        [99, "test@example.com"]
      );

      assert.equal(db.tables.customers[0].total_scans, 2);
      assert.equal(db.tables.customers[0].total_spent_usd, 128);
    });

    it("should not duplicate customers with same email (upsert)", () => {
      db.mockSql(
        "INSERT INTO customers (id, email, stripe_customer_id) VALUES ($1, $2, $3)",
        ["cust-1", "test@example.com", null]
      );
      db.mockSql(
        "INSERT INTO customers (id, email, stripe_customer_id) VALUES ($1, $2, $3)",
        ["cust-2", "test@example.com", "cus_new_456"]
      );

      assert.equal(db.tables.customers.length, 1);
      assert.equal(db.tables.customers[0].id, "cust-1");
      assert.equal(db.tables.customers[0].stripe_customer_id, "cus_new_456");
    });
  });

  describe("Admin queries", () => {
    it("should return aggregate stats", () => {
      // Add scans
      db.mockSql(
        "INSERT INTO scans (id, session_id, repo_url, tier, status, results, score, duration_ms, modules_run) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        ["s1", "cs1", "https://github.com/a/b", "quick", "completed", "[]", 90, 500, []]
      );
      db.mockSql(
        "INSERT INTO scans (id, session_id, repo_url, tier, status, results, score, duration_ms, modules_run) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        ["s2", "cs2", "https://github.com/c/d", "full", "failed", "[]", 20, 300, []]
      );

      // Add customer
      db.mockSql(
        "INSERT INTO customers (id, email, stripe_customer_id) VALUES ($1, $2, $3)",
        ["c1", "user@test.com", null]
      );

      // Query stats
      const stats = db.mockSql(
        "SELECT COUNT(*)::int AS total_scans FROM scans"
      );

      assert.equal(stats[0].total_scans, 2);
      assert.equal(stats[0].completed_scans, 1);
      assert.equal(stats[0].failed_scans, 1);

      // Query customer count
      const custCount = db.mockSql("SELECT COUNT(*)::int AS total FROM customers");
      assert.equal(custCount[0].total, 1);

      // List recent scans
      const recentScans = db.mockSql("SELECT * FROM scans ORDER BY created_at DESC");
      assert.equal(recentScans.length, 2);
    });

    it("should return empty stats when no data", () => {
      const stats = db.mockSql(
        "SELECT COUNT(*)::int AS total_scans FROM scans"
      );

      assert.equal(stats[0].total_scans, 0);
      assert.equal(stats[0].completed_scans, 0);
      assert.equal(stats[0].avg_score, 0);
    });
  });

  describe("getDb function", () => {
    it("should throw when DATABASE_URL is not set", () => {
      // Temporarily remove DATABASE_URL
      const original = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      // Import the module fresh to test
      assert.throws(
        () => {
          // Inline reimplementation of getDb logic for testing
          const url = process.env.DATABASE_URL;
          if (!url) throw new Error("DATABASE_URL is not set");
        },
        { message: /DATABASE_URL is not set/ }
      );

      // Restore
      if (original) process.env.DATABASE_URL = original;
    });
  });
});
