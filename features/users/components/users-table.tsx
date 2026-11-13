"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { fr } from "date-fns/locale";
import { KeyRound, LogOut, MoreHorizontal, Pencil, Plus, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { resetUserPasswordAction, revokeUserSessionsAction, setUserStatusAction } from "@/features/users/actions";
import type { UserListItem } from "@/features/users/service";
import { TemporaryPasswordDialog } from "@/features/users/components/temporary-password-dialog";
import { UserFormDialog } from "@/features/users/components/user-form-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, ListSearch, type DataTablePagination } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { createAppColumnHelper } from "@/lib/table";
import { initials } from "@/lib/text";

const ROLE_TONES: Record<Role, StatusTone> = {
  SUPER_ADMIN: "danger",
  ADMIN: "info",
  FINANCE_MANAGER: "success",
  CHILD_MANAGER: "warning",
  MEDIA_MANAGER: "neutral",
  VIDEO_UPLOADER: "neutral",
};

function lastLogin(value: string | null): string {
  return value ? formatDistanceToNowStrict(new Date(value), { addSuffix: true, locale: fr }) : "Jamais";
}

type PendingAction =
  | { kind: "disable" | "enable" | "reset" | "revoke"; user: UserListItem }
  | null;

export function UsersTable({
  users,
  pagination,
  currentUserId,
  hasQuery,
}: {
  users: UserListItem[];
  pagination: DataTablePagination;
  currentUserId: string;
  hasQuery: boolean;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [secret, setSecret] = useState<{ email: string; temporaryPassword: string; title: string } | null>(null);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function RowActions({ user }: { user: UserListItem }) {
    const self = user.id === currentUserId;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions pour ${user.name}`} onClick={(event) => event.stopPropagation()} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem
            onClick={() => {
              setEditing(user);
              setFormOpen(true);
            }}
          >
            <Pencil aria-hidden />
            Modifier
          </DropdownMenuItem>
          {!self ? (
            <DropdownMenuItem onClick={() => setPending({ kind: "reset", user })}>
              <KeyRound aria-hidden />
              Réinitialiser le mot de passe
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setPending({ kind: "revoke", user })} disabled={user.activeSessions === 0}>
            <LogOut aria-hidden />
            {self ? "Fermer mes autres sessions" : "Fermer les sessions"}
          </DropdownMenuItem>
          {!self ? (
            <>
              <DropdownMenuSeparator />
              {user.status === "ACTIVE" ? (
                <DropdownMenuItem onClick={() => setPending({ kind: "disable", user })} className="text-destructive focus:text-destructive">
                  <UserX aria-hidden />
                  Désactiver le compte
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => setPending({ kind: "enable", user })}>
                  <UserCheck aria-hidden />
                  Réactiver le compte
                </DropdownMenuItem>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const helper = createAppColumnHelper<UserListItem>();
  const columns = helper.columns([
    helper.accessor("name", {
      header: "Utilisateur",
      meta: { sortKey: "name" },
      cell: (info) => {
        const user = info.row.original;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-8">
              <AvatarFallback className="bg-muted text-xs font-medium">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {user.name}
                {user.id === currentUserId ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(vous)</span> : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
        );
      },
    }),
    helper.accessor("role", {
      header: "Rôle",
      meta: { sortKey: "role" },
      cell: (info) => <StatusBadge tone={ROLE_TONES[info.getValue()]}>{ROLE_LABELS[info.getValue()]}</StatusBadge>,
    }),
    helper.accessor("status", {
      header: "Statut",
      cell: (info) => {
        const user = info.row.original;
        if (user.status === "DISABLED") return <StatusBadge tone="neutral">Désactivé</StatusBadge>;
        if (user.mustChangePassword) return <StatusBadge tone="warning">Mot de passe à définir</StatusBadge>;
        return <StatusBadge tone="success">Actif</StatusBadge>;
      },
    }),
    helper.accessor("lastLoginAt", {
      header: "Dernière connexion",
      meta: { sortKey: "lastLoginAt", hideBelow: "lg" },
      cell: (info) => <span className="text-muted-foreground">{lastLogin(info.getValue())}</span>,
    }),
    helper.accessor("activeSessions", {
      header: "Sessions",
      meta: { align: "end", hideBelow: "lg" },
      cell: (info) => <span className="text-muted-foreground">{info.getValue()}</span>,
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      meta: { align: "end", cellClassName: "w-12" },
      cell: (info) => <RowActions user={info.row.original} />,
    }),
  ]);

  async function runPending(): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!pending) return { ok: true };
    const { kind, user } = pending;
    if (kind === "reset") {
      const result = await resetUserPasswordAction({ userId: user.id });
      if (!result.ok) return { ok: false, message: result.message };
      setSecret({ email: user.email, temporaryPassword: result.data.temporaryPassword, title: "Mot de passe réinitialisé" });
      return { ok: true };
    }
    const result =
      kind === "revoke"
        ? await revokeUserSessionsAction({ userId: user.id })
        : await setUserStatusAction({ userId: user.id }, kind === "disable" ? "DISABLED" : "ACTIVE");
    if (!result.ok) return { ok: false, message: result.message };
    toast.success(result.message ?? "Opération effectuée.");
    return { ok: true };
  }

  const confirmCopy: Record<NonNullable<PendingAction>["kind"], { title: string; description: string; label: string; destructive: boolean }> = {
    disable: {
      title: "Désactiver ce compte ?",
      description: "L'utilisateur ne pourra plus se connecter et ses sessions ouvertes seront fermées immédiatement. L'historique est conservé.",
      label: "Désactiver",
      destructive: true,
    },
    enable: { title: "Réactiver ce compte ?", description: "L'utilisateur pourra de nouveau se connecter avec son mot de passe.", label: "Réactiver", destructive: false },
    reset: {
      title: "Réinitialiser le mot de passe ?",
      description: "Un nouveau mot de passe temporaire sera généré, l'ancien cessera de fonctionner et toutes les sessions seront fermées.",
      label: "Réinitialiser",
      destructive: true,
    },
    revoke: { title: "Fermer les sessions ?", description: "Les appareils connectés devront s'identifier à nouveau.", label: "Fermer les sessions", destructive: false },
  };
  const copy = pending ? confirmCopy[pending.kind] : null;

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ListSearch placeholder="Rechercher un nom ou une adresse…" />
        <Button onClick={openCreate}>
          <Plus aria-hidden />
          Nouveau compte
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={users}
        pagination={pagination}
        emptyState={
          hasQuery ? (
            <EmptyState title="Aucun compte trouvé" description="Aucun compte ne correspond à cette recherche." />
          ) : (
            <EmptyState
              title="Aucun compte"
              description="Créez les comptes des membres de l'organisation."
              action={
                <Button onClick={openCreate}>
                  <Plus aria-hidden />
                  Nouveau compte
                </Button>
              }
            />
          )
        }
        renderMobileItem={(user) => (
          <div className="flex items-center gap-3 px-4 py-3">
            <Avatar className="size-9">
              <AvatarFallback className="bg-muted text-xs font-medium">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <StatusBadge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</StatusBadge>
                {user.status === "DISABLED" ? <StatusBadge>Désactivé</StatusBadge> : null}
                {user.status === "ACTIVE" && user.mustChangePassword ? <StatusBadge tone="warning">Mot de passe à définir</StatusBadge> : null}
              </div>
            </div>
            <RowActions user={user} />
          </div>
        )}
      />

      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        user={editing}
        currentUserId={currentUserId}
        onCreated={({ email, temporaryPassword }) => setSecret({ email, temporaryPassword, title: "Compte créé" })}
      />

      {copy ? (
        <ConfirmDialog
          open={pending !== null}
          onOpenChange={(open) => !open && setPending(null)}
          title={copy.title}
          description={
            <>
              <span className="font-medium text-foreground">{pending?.user.name}</span> — {copy.description}
            </>
          }
          confirmLabel={copy.label}
          destructive={copy.destructive}
          onConfirm={runPending}
        />
      ) : null}

      <TemporaryPasswordDialog value={secret} onClose={() => setSecret(null)} />
    </>
  );
}
