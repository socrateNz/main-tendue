import Link from "next/link";
import { SearchX } from "lucide-react";

import { EmptyState } from "@/components/shared/states";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card shadow-panel">
        <EmptyState
          icon={SearchX}
          title="Page introuvable"
          description="Cette page n'existe pas ou n'est pas encore disponible."
          action={
            <Link href="/tableau-de-bord" className={buttonVariants({ variant: "outline" })}>
              Retour au tableau de bord
            </Link>
          }
        />
      </div>
    </main>
  );
}
