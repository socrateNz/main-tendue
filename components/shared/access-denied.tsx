import Link from "next/link";
import { ShieldOff } from "lucide-react";

import { PageContainer } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";

/** Rendu d'une page lorsque le rôle de l'utilisateur n'a pas la permission requise. */
export function AccessDenied() {
  return (
    <PageContainer>
      <div className="rounded-xl border bg-card shadow-card">
        <EmptyState
          icon={ShieldOff}
          title="Accès refusé"
          description="Votre rôle ne permet pas d'accéder à cette page. Contactez un administrateur si nécessaire."
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
