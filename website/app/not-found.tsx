import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page Not Found — GateTest",
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="text-center max-w-md">
        <p className="text-6xl font-bold text-accent mb-4">404</p>
        <h1 className="text-2xl font-bold mb-2">Page not found</h1>
        <p className="text-muted mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="/" className="btn-primary px-6 py-3 text-sm text-center">
            Back to Home
          </a>
          <a href="/dashboard" className="btn-secondary px-6 py-3 text-sm text-center">
            My Scans
          </a>
        </div>
      </div>
    </div>
  );
}
