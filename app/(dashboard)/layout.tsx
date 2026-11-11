import { Suspense } from "react";

import { AppShell, AppShellSkeleton } from "@/components/layout/app-shell";

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
