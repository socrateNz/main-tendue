import Link from "next/link";
import { SearchX } from "lucide-react";

import { PageContainer } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";

export default function DashboardNotFound() {
  return (
    <PageContainer>
      <div className="rounded-xl border bg-card shadow-card">
        <EmptyState
          icon={SearchX}
          title="Page introuvable"
          description="L'élément demandé n'existe pas ou a été déplacé."
          action={
            <Link href="/tableau-de-bord" className={buttonVariants({ variant: "outline" })}>
              Retour au tableau de bord
            </Link>
          }
        />
      </div>
    </PageContainer>
  );
}
