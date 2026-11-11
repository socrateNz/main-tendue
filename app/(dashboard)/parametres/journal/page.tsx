import type { Metadata } from "next";

import { AuditTable } from "@/features/audit/components/audit-table";
import { AUDIT_DOMAINS, AUDIT_SORTS, listAudit } from "@/features/audit/queries";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { authorizePage } from "@/lib/auth/session";
import { parseListParams } from "@/lib/db/pagination";

export const metadata: Metadata = { title: "Journal d'audit" };

export default async function AuditPage({ searchParams }: PageProps<"/parametres/journal">) {
  const auth = await authorizePage("audit:read");
  if (!auth.ok) return <AccessDenied />;
  const raw = await searchParams;
  const params = parseListParams(raw, { sortable: AUDIT_SORTS, defaultSort: "at", defaultDir: "desc" });
  const domain = typeof raw.domaine === "string" ? raw.domaine : null;
  const result = await listAudit(params, { domain, actor: null });
  return (
    <PageContainer>
      <PageHeader
        title="Journal d'audit"
        description="Toutes les opérations importantes : connexions, créations, modifications, annulations, opérations financières et accès aux vidéos. Le journal ne peut être ni modifié ni effacé."
      />
      <AuditTable
        rows={result.items}
        pagination={{ page: result.page, pageSize: result.pageSize, total: result.total, pageCount: result.pageCount }}
        domains={Object.entries(AUDIT_DOMAINS).map(([value, label]) => ({ value, label }))}
      />
    </PageContainer>
  );
}
