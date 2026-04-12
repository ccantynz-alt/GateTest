import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Scans — GateTest",
  description: "View your GateTest scan history and results.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
