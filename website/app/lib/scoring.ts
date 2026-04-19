/**
 * Quality scoring and grading system.
 *
 * Calculates a 0-100 score from scan results and assigns a letter grade.
 * Used by: scan results display, badge API, dashboard, PDF reports.
 *
 * Scoring:
 *   Start at 100. Deduct per issue:
 *     - error: -5
 *     - warning: -2
 *     - info: 0 (informational, doesn't affect score)
 *   Floor at 0. Cap at 100.
 *
 * Grades:
 *   A+ (95+), A (90+), A- (85+)
 *   B+ (80+), B (75+), B- (70+)
 *   C+ (65+), C (60+), C- (55+)
 *   D+ (50+), D (40+), D- (30+)
 *   F (<30)
 */

export interface Grade {
  letter: string;
  score: number;
  color: string;
  bgColor: string;
  label: string;
}

export function calculateScore(modules: Array<{ status: string; issues: number; details?: string[] }>): number {
  let score = 100;
  for (const mod of modules) {
    if (mod.status === "failed" || mod.status === "warning") {
      const details = mod.details || [];
      for (const d of details) {
        if (d.startsWith("error") || d.includes("error:")) score -= 5;
        else if (d.startsWith("warning") || d.includes("warning:")) score -= 2;
      }
      // If no parsed severity, deduct based on issue count
      if (details.length === 0 && mod.issues > 0) {
        score -= mod.issues * 3;
      }
    }
  }
  return Math.max(0, Math.min(100, score));
}

export function scoreToGrade(score: number): Grade {
  if (score >= 95) return { letter: "A+", score, color: "#fff", bgColor: "#059669", label: "Excellent" };
  if (score >= 90) return { letter: "A", score, color: "#fff", bgColor: "#059669", label: "Great" };
  if (score >= 85) return { letter: "A-", score, color: "#fff", bgColor: "#10b981", label: "Very Good" };
  if (score >= 80) return { letter: "B+", score, color: "#fff", bgColor: "#0d9488", label: "Good" };
  if (score >= 75) return { letter: "B", score, color: "#fff", bgColor: "#0891b2", label: "Above Average" };
  if (score >= 70) return { letter: "B-", score, color: "#fff", bgColor: "#2563eb", label: "Decent" };
  if (score >= 65) return { letter: "C+", score, color: "#fff", bgColor: "#7c3aed", label: "Fair" };
  if (score >= 60) return { letter: "C", score, color: "#fff", bgColor: "#9333ea", label: "Below Average" };
  if (score >= 55) return { letter: "C-", score, color: "#fff", bgColor: "#c026d3", label: "Needs Work" };
  if (score >= 50) return { letter: "D+", score, color: "#fff", bgColor: "#d97706", label: "Poor" };
  if (score >= 40) return { letter: "D", score, color: "#fff", bgColor: "#ea580c", label: "Bad" };
  if (score >= 30) return { letter: "D-", score, color: "#fff", bgColor: "#dc2626", label: "Very Bad" };
  return { letter: "F", score, color: "#fff", bgColor: "#991b1b", label: "Critical" };
}
