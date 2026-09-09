import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";

export function AppShell({ breadcrumbs, children }: { breadcrumbs?: { label: string; to?: string }[]; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-fig-bg">
      <AppHeader breadcrumbs={breadcrumbs} />
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}
