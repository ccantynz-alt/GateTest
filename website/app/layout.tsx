import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GateTest — AI writes fast. GateTest keeps it honest.",
  description:
    "20 test modules scan your entire codebase. Security, accessibility, performance, and more. We find the bugs AND fix them. Pay only when the scan completes.",
  keywords: [
    "QA",
    "testing",
    "quality assurance",
    "AI testing",
    "security scanning",
    "accessibility",
    "performance",
    "visual regression",
    "CI/CD",
    "code quality",
    "mutation testing",
    "auto-fix",
  ],
  openGraph: {
    title: "GateTest — AI writes fast. GateTest keeps it honest.",
    description:
      "20 test modules scan your entire codebase. We find the bugs AND fix them. Pay only when the scan completes.",
    url: "https://gatetest.io",
    siteName: "GateTest",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GateTest — AI writes fast. GateTest keeps it honest.",
    description:
      "20 test modules scan your entire codebase. We find the bugs AND fix them. Pay only when the scan completes.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
