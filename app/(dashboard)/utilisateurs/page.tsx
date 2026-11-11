import type { Metadata } from "next";

import { UsersTable } from "@/features/users/components/users-table";
import { listUsers, USER_SORTS } from "@/features/users/service";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { authorizePage } from "@/lib/auth/session";
import { parseListParams } from "@/lib/db/pagination";

export const metadata: Metadata = { title: "Utilisateurs" };

export default async function UsersPage({ searchParams }: PageProps<"/utilisateurs">) {
  const auth = await authorizePage("users:manage");
  if (!auth.ok) return <AccessDenied />;

  const params = parseListParams(await searchParams, { sortable: USER_SORTS, defaultSort: "name" });
  const result = await listUsers(params);

  return (
    <PageContainer>
      <PageHeader
        title="Utilisateurs"
        description="Membres de l'organisation autorisés à accéder à l'espace de gestion. Les sponsors n'ont pas de compte."
      />
      <UsersTable
        users={result.items}
        pagination={{ page: result.page, pageSize: result.pageSize, total: result.total, pageCount: result.pageCount }}
        currentUserId={auth.user.id}
        hasQuery={params.q.length > 0}
      />
    </PageContainer>
  );
}
