"use client";

import { AlertCircle, CheckCircle2, Loader2, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createExpenseAction } from "@/features/expenses/actions";
import { ALLOCATION_MODE_LABELS, EXPENSE_SCOPES, EXPENSE_SCOPE_LABELS, equalAllocations, type AllocationMode, type ExpenseScope } from "@/features/expenses/types";
import { searchChildrenAction } from "@/features/sponsors/actions";
import { EntityPicker, type PickerValue } from "@/components/shared/entity-picker";
import { FormSection } from "@/components/shared/form-section";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toDateInput } from "@/lib/dates";
import { formatXaf } from "@/lib/money";
import { cn } from "@/lib/utils";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50";

const SCOPE_HINTS: Record<ExpenseScope, string> = {
  GENERAL: "Frais de fonctionnement sans enfant précis.",
  INDIVIDUAL: "Concerne un seul enfant.",
  COLLECTIVE: "Une seule dépense, répartie entre plusieurs enfants.",
};

export function ExpenseForm({ categories }: { categories: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [spentAt, setSpentAt] = useState(toDateInput(new Date()));
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [scope, setScope] = useState<ExpenseScope>("GENERAL");
  const [mode, setMode] = useState<AllocationMode>("EQUAL");
  const [children, setChildren] = useState<PickerValue[]>([]);
  const [manual, setManual] = useState<Record<string, number | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const selectable = scope === "INDIVIDUAL" ? children.slice(0, 1) : children;
  const preview =
    scope === "GENERAL" || !amount || selectable.length === 0
      ? []
      : scope === "INDIVIDUAL"
        ? [{ childId: selectable[0].id, amount }]
        : mode === "EQUAL"
          ? equalAllocations(amount, selectable.map((c) => c.id))
          : selectable.map((c) => ({ childId: c.id, amount: manual[c.id] ?? 0 }));
  const allocatedSum = preview.reduce((sum, p) => sum + p.amount, 0);
  const balanced = scope === "GENERAL" || (amount !== undefined && allocatedSum === amount);

  function addChild(child: PickerValue | null) {
    if (!child || children.some((c) => c.id === child.id)) return;
    setChildren(scope === "INDIVIDUAL" ? [child] : [...children, child]);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!amount) local.amount = "Saisissez le montant.";
    if (!categoryId) local.categoryId = "Choisissez une catégorie.";
    if (description.trim().length < 3) local.description = "Décrivez la dépense.";
    if (scope === "INDIVIDUAL" && selectable.length !== 1) local.allocations = "Choisissez l'enfant concerné.";
    if (scope === "COLLECTIVE" && selectable.length < 2) local.allocations = "Choisissez au moins deux enfants.";
    if (scope !== "GENERAL" && !balanced && !local.allocations) local.allocations = "La somme des parts doit être égale au montant.";
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Certains éléments sont à corriger.");
    setFormError(null);
    startTransition(async () => {
      const result = await createExpenseAction({
        spentAt,
        categoryId,
        amount,
        description,
        supplier,
        reference,
        scope,
        allocationMode: scope === "COLLECTIVE" ? mode : undefined,
        allocations: preview,
      });
      if (!result.ok) {
        setErrors(Object.fromEntries(Object.entries(result.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
        return void setFormError(result.message);
      }
      toast.success(result.message ?? "Dépense enregistrée.");
      router.push(`/depenses/${result.data.expenseId}`);
      router.refresh();
    });
  }

  const err = (key: string) => (errors[key] ? <FieldError>{errors[key]}</FieldError> : null);

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {formError ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{formError}</span>
        </div>
      ) : null}
      <div className="rounded-xl border bg-card p-5 shadow-card md:p-6">
        <FormSection title="Dépense" description="La date réelle détermine l'année scolaire du mouvement.">
          <Field data-invalid={Boolean(errors.spentAt) || undefined}>
            <FieldLabel htmlFor="exp-date">Date</FieldLabel>
            <Input id="exp-date" type="date" value={spentAt} max={toDateInput(new Date())} onChange={(e) => setSpentAt(e.target.value)} disabled={pending} />
            {err("spentAt")}
          </Field>
          <Field data-invalid={Boolean(errors.amount) || undefined}>
            <FieldLabel htmlFor="exp-amount">Montant</FieldLabel>
            <MoneyInput id="exp-amount" value={amount} onChange={setAmount} disabled={pending} />
            {err("amount")}
          </Field>
          <Field data-invalid={Boolean(errors.categoryId) || undefined}>
            <FieldLabel htmlFor="exp-category">Catégorie</FieldLabel>
            <select id="exp-category" className={selectClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={pending}>
              {categories.length === 0 ? <option value="">Aucune catégorie active</option> : null}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {categories.length === 0 ? (
              <FieldDescription>
                <Link href="/depenses/categories" className="text-primary hover:underline">
                  Créer une catégorie
                </Link>
              </FieldDescription>
            ) : null}
            {err("categoryId")}
          </Field>
          <Field>
            <FieldLabel htmlFor="exp-supplier">Fournisseur (facultatif)</FieldLabel>
            <Input id="exp-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} disabled={pending} />
          </Field>
          <Field className="sm:col-span-2" data-invalid={Boolean(errors.description) || undefined}>
            <FieldLabel htmlFor="exp-description">Description</FieldLabel>
            <Textarea id="exp-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={pending} />
            {err("description")}
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="exp-ref">Référence de pièce (facultatif)</FieldLabel>
            <Input id="exp-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° de facture, de reçu…" disabled={pending} />
          </Field>
        </FormSection>

        <FormSection title="Bénéficiaires" description="Les parts servent à suivre la dépense par enfant ; elles ne sont jamais additionnées une seconde fois.">
          <fieldset className="sm:col-span-2">
            <legend className="sr-only">Portée</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {EXPENSE_SCOPES.map((value) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer flex-col rounded-lg border px-3 py-2.5 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                    scope === value ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <input type="radio" name="scope" value={value} checked={scope === value} onChange={() => setScope(value)} className="sr-only" disabled={pending} />
                  <span className={cn("font-medium", scope === value && "text-primary")}>{EXPENSE_SCOPE_LABELS[value]}</span>
                  <span className="text-xs text-muted-foreground">{SCOPE_HINTS[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {scope !== "GENERAL" ? (
            <>
              <Field className="sm:col-span-2" data-invalid={Boolean(errors.allocations) || undefined}>
                <FieldLabel htmlFor="exp-child">{scope === "INDIVIDUAL" ? "Enfant concerné" : "Ajouter un enfant"}</FieldLabel>
                <EntityPicker id="exp-child" value={null} onChange={addChild} search={searchChildrenAction} placeholder="Nom, code…" disabled={pending} />
              </Field>
              {scope === "COLLECTIVE" ? (
                <div className="flex gap-2 sm:col-span-2">
                  {(["EQUAL", "MANUAL"] as const).map((value) => (
                    <Button key={value} type="button" size="sm" variant={mode === value ? "secondary" : "ghost"} onClick={() => setMode(value)} aria-pressed={mode === value}>
                      {ALLOCATION_MODE_LABELS[value]}
                    </Button>
                  ))}
                </div>
              ) : null}
              <div className="sm:col-span-2">
                {selectable.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">Aucun enfant sélectionné.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {selectable.map((child, index) => {
                      const part = preview.find((p) => p.childId === child.id)?.amount ?? 0;
                      return (
                        <li key={child.id} className="flex items-center gap-3 px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {child.label}
                            {index === 0 && scope === "COLLECTIVE" && mode === "EQUAL" && amount && amount % selectable.length !== 0 ? (
                              <span className="text-xs text-muted-foreground"> (reçoit le reste)</span>
                            ) : null}
                          </span>
                          {scope === "COLLECTIVE" && mode === "MANUAL" ? (
                            <div className="w-40">
                              <MoneyInput aria-label={`Part de ${child.label}`} value={manual[child.id]} onChange={(v) => setManual((m) => ({ ...m, [child.id]: v }))} disabled={pending} />
                            </div>
                          ) : (
                            <Money amount={part} className="text-sm font-medium" />
                          )}
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setChildren(children.filter((c) => c.id !== child.id))} aria-label={`Retirer ${child.label}`} disabled={pending}>
                            <Trash2 />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {selectable.length > 0 && amount ? (
                  <p className={cn("mt-2 flex items-center gap-2 text-sm", balanced ? "text-success" : "text-warning")} role="status">
                    {balanced ? <CheckCircle2 className="size-4" aria-hidden /> : <TriangleAlert className="size-4" aria-hidden />}
                    {balanced ? "Parts équilibrées." : `Parts : ${formatXaf(allocatedSum)} sur ${formatXaf(amount)}.`}
                  </p>
                ) : null}
                {err("allocations")}
              </div>
            </>
          ) : null}
        </FormSection>
      </div>
      <div className="flex justify-end gap-2">
        <Link href="/depenses" className={buttonVariants({ variant: "outline" })}>
          Annuler
        </Link>
        <Button type="submit" disabled={pending || categories.length === 0}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Enregistrer la dépense
        </Button>
      </div>
    </form>
  );
}
