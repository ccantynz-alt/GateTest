"use client";

// App Router global error boundary — catches errors in the root
// layout AND any React render error that escapes a more-specific
// error boundary. Without this file, a render error in the root
// layout produces a default Next.js error page with no stack-trace
// reporting; with it, every such error reaches Sentry.

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
