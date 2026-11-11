"use client";

import { Loader2, Pencil, Plus, Tags } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createCategoryAction, updateCategoryAction } from "@/features/expenses/actions";
import type { CategoryItem } from "@/features/expenses/queries";
import { DataTable } from "@/components/shared/data-table";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createAppColumnHelper } from "@/lib/table";

export function CategoriesTable({ categories, canManage }: { categories: CategoryItem[]; canManage: boolean }) {
  const [dialog, setDialog] = useState<{ category: CategoryItem | null } | null>(null);
  const helper = createAppColumnHelper<CategoryItem>();
  const columns = helper.columns([
    helper.accessor("name", {
      header: "Catégorie",
      cell: (info) => (
        <span className="flex flex-col">
          <span className="font-medium">{info.getValue()}</span>
          {info.row.original.description ? <span className="text-xs text-muted-foreground">{info.row.original.description}</span> : null}
        </span>
      ),
    }),
    helper.accessor("count", { header: "Dépenses", meta: { align: "end", hideBelow: "sm" }, cell: (info) => info.getValue() }),
    helper.accessor("total", { header: "Total (toutes années)", meta: { align: "end" }, cell: (info) => <Money amount={info.getValue()} /> }),
    helper.accessor("active", { header: "Statut", meta: { hideBelow: "sm" }, cell: (info) => (info.getValue() ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge>Désactivée</StatusBadge>) }),
    ...(canManage
      ? [
          helper.display({
            id: "edit",
            header: () => <span className="sr-only">Modifier</span>,
            meta: { align: "end", cellClassName: "w-12" },
            cell: (info) => (
              <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ category: info.row.original })} aria-label={`Modifier ${info.row.original.name}`}>
                <Pencil />
              </Button>
            ),
          }),
        ]
      : []),
  ]);
  return (
    <>
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setDialog({ category: null })}>
            <Plus aria-hidden />
            Nouvelle catégorie
          </Button>
        </div>
      ) : null}
      <DataTable columns={columns} data={categories} emptyState={<EmptyState icon={Tags} title="Aucune catégorie" description="Créez les catégories de dépenses : fournitures, frais de scolarité, uniformes, transport…" />} />
      {dialog ? <CategoryDialog key={dialog.category?.id ?? "new"} category={dialog.category} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function CategoryDialog({ category, onClose }: { category: CategoryItem | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [active, setActive] = useState(category?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Le nom est obligatoire.");
    startTransition(async () => {
      const data = { name, description };
      const result = category ? await updateCategoryAction({ categoryId: category.id, data, active }) : await createCategoryAction(data);
      if (!result.ok) return void setError(result.fieldErrors?.name?.[0] ?? result.message);
      toast.success(result.message ?? "Enregistré.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{category ? "Modifier la catégorie" : "Nouvelle catégorie"}</DialogTitle>
            <DialogDescription>Une catégorie désactivée n&apos;est plus proposée ; ses dépenses passées restent inchangées.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(error) || undefined}>
              <FieldLabel htmlFor="cat-name">Nom</FieldLabel>
              <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} disabled={pending} autoFocus />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="cat-desc">Description (facultatif)</FieldLabel>
              <Input id="cat-desc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={pending} />
            </Field>
            {category ? (
              <label className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm">
                Catégorie active
                <Switch checked={active} onCheckedChange={setActive} disabled={pending} />
              </label>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
