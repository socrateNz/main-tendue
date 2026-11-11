import { PageContainer } from "@/components/shared/page-header";
import { DataTableSkeleton } from "@/components/shared/data-table";

/** Chargement d'une page de l'espace de gestion (le cadre reste affiché). */
export default function DashboardLoading() {
  return (
    <PageContainer>
      <div className="space-y-2" aria-hidden>
        <div className="h-7 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted/70" />
      </div>
      <DataTableSkeleton />
    </PageContainer>
  );
}
