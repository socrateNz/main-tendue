"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, Pencil, Plus, School } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createSchoolAction, updateSchoolAction } from "@/features/children/actions";
import type { SchoolListItem } from "@/features/children/queries";
import { type SchoolData, type SchoolInput, schoolSchema } from "@/features/children/schemas";
import { SCHOOL_TYPES, SCHOOL_TYPE_LABELS } from "@/features/children/types";
import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createAppColumnHelper } from "@/lib/table";

export function SchoolsTable({ schools, activeYearLabel, canWrite }: { schools: SchoolListItem[]; activeYearLabel: string | null; canWrite: boolean }) {
  const [dialog, setDialog] = useState<{ school: SchoolListItem | null } | null>(null);

  const helper = createAppColumnHelper<SchoolListItem>();
  const columns = helper.columns([
    helper.accessor("name", {
      header: "Établissement",
      cell: (info) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{info.getValue()}</span>
          <span className="text-xs text-muted-foreground">{SCHOOL_TYPE_LABELS[info.row.original.type]}</span>
        </span>
      ),
    }),
    helper.accessor("city", { header: "Ville", meta: { hideBelow: "md" }, cell: (info) => info.getValue() ?? "—" }),
    helper.accessor("phone", { header: "Contact", meta: { hideBelow: "lg" }, cell: (info) => <span className="text-muted-foreground">{info.getValue() ?? info.row.original.email ?? "—"}</span> }),
    helper.accessor("enrolledThisYear", {
      header: activeYearLabel ? `Inscrits ${activeYearLabel}` : "Inscrits",
      meta: { align: "end" },
      cell: (info) => (
        <span className="tabular-nums">
          {info.getValue()}
          <span className="text-xs text-muted-foreground"> / {info.row.original.enrolledTotal} au total</span>
        </span>
      ),
    }),
    helper.accessor("active", {
      header: "Statut",
      meta: { hideBelow: "sm" },
      cell: (info) => (info.getValue() ? <StatusBadge tone="success">Actif</StatusBadge> : <StatusBadge>Désactivé</StatusBadge>),
    }),
    ...(canWrite
      ? [
          helper.display({
            id: "edit",
            header: () => <span className="sr-only">Modifier</span>,
            meta: { align: "end", cellClassName: "w-12" },
            cell: (info) => (
              <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ school: info.row.original })} aria-label={`Modifier ${info.row.original.name}`}>
                <Pencil />
              </Button>
            ),
          }),
        ]
      : []),
  ]);

  return (
    <>
      {canWrite ? (
        <div className="flex justify-end">
          <Button onClick={() => setDialog({ school: null })}>
            <Plus aria-hidden />
            Nouvel établissement
          </Button>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        data={schools}
        emptyState={
          <EmptyState
            icon={School}
            title="Aucun établissement"
            description="Enregistrez les établissements fréquentés par les enfants pour renseigner leur scolarité."
            action={
              canWrite ? (
                <Button onClick={() => setDialog({ school: null })}>
                  <Plus aria-hidden />
                  Nouvel établissement
                </Button>
              ) : undefined
            }
          />
        }
      />
      {dialog ? <SchoolDialog key={dialog.school?.id ?? "new"} school={dialog.school} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50";

function SchoolDialog({ school, onClose }: { school: SchoolListItem | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [active, setActive] = useState(school?.active ?? true);
  const form = useForm<SchoolInput, unknown, SchoolData>({
    resolver: zodResolver(schoolSchema),
    defaultValues: {
      name: school?.name ?? "",
      type: school?.type ?? "PRIMARY",
      city: school?.city ?? "",
      address: school?.address ?? "",
      phone: school?.phone ?? "",
      email: school?.email ?? "",
    },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = school ? await updateSchoolAction({ schoolId: school.id, data: values, active }) : await createSchoolAction(values);
      if (!result.ok) {
        for (const [path, messages] of Object.entries(result.fieldErrors ?? {})) {
          if (messages[0]) form.setError(path as keyof SchoolInput, { type: "server", message: messages[0] });
        }
        return void setFormError(result.message);
      }
      toast.success(result.message ?? "Enregistré.");
      onClose();
      router.refresh();
    });
  });

  const field = (name: keyof SchoolInput, label: string, type = "text", className?: string) => (
    <Field data-invalid={Boolean(errors[name]) || undefined} className={className}>
      <FieldLabel htmlFor={`school-${name}`}>{label}</FieldLabel>
      <Input id={`school-${name}`} type={type} autoComplete="off" disabled={pending} aria-invalid={Boolean(errors[name]) || undefined} {...form.register(name)} />
      <FieldError errors={[errors[name]]} />
    </Field>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{school ? "Modifier l'établissement" : "Nouvel établissement"}</DialogTitle>
            <DialogDescription>Un même nom ne peut exister qu&apos;une fois par ville.</DialogDescription>
          </DialogHeader>
          {formError ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{formError}</span>
            </div>
          ) : null}
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("name", "Nom", "text", "sm:col-span-2")}
              <Field>
                <FieldLabel htmlFor="school-type">Type</FieldLabel>
                <select id="school-type" className={selectClass} disabled={pending} {...form.register("type")}>
                  {SCHOOL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {SCHOOL_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </Field>
              {field("city", "Ville")}
              {field("address", "Adresse", "text", "sm:col-span-2")}
              {field("phone", "Téléphone", "tel")}
              {field("email", "E-mail", "email")}
            </div>
            {school ? (
              <label className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5 text-sm">
                <span>
                  <span className="font-medium">Établissement actif</span>
                  <span className="block text-xs text-muted-foreground">Désactivé : n&apos;est plus proposé pour les nouvelles inscriptions.</span>
                </span>
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
