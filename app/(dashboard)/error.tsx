"use client";

import { RotateCcw } from "lucide-react";

import { PageContainer } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";

export default function DashboardError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageContainer>
      <div className="rounded-xl border bg-card shadow-card">
        <ErrorState
          action={
            <Button variant="outline" onClick={() => retry()}>
              <RotateCcw aria-hidden />
              Réessayer
            </Button>
          }
        />
      </div>
    </PageContainer>
  );
}
