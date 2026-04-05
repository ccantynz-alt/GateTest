import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GateTest — AI writes fast. GateTest keeps it honest.",
  description:
    "The advanced QA gate between AI and GitHub. 16 test modules. One gate. Nothing ships unless it's pristine. Replace 10 testing tools with one unified quality system.",
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
  ],
  openGraph: {
    title: "GateTest — AI writes fast. GateTest keeps it honest.",
    description:
      "The advanced QA gate between AI and GitHub. 16 test modules. One gate. Nothing ships unless it's pristine.",
    url: "https://gatetest.io",
    siteName: "GateTest",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GateTest — AI writes fast. GateTest keeps it honest.",
    description:
      "The advanced QA gate between AI and GitHub. 16 test modules. One gate. Nothing ships unless it's pristine.",
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
