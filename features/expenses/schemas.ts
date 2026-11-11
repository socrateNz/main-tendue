import { z } from "zod";

import { objectIdSchema, optionalText } from "@/features/children/schemas";
import { dateInputSchema } from "@/features/school-years/schemas";
import { MAX_XAF_AMOUNT } from "@/lib/money";

import { ALLOCATION_MODES, EXPENSE_SCOPES, checkExpenseAllocations } from "./types";

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(100),
  description: optionalText(500),
});

export const updateCategorySchema = z.object({ categoryId: objectIdSchema, data: categorySchema, active: z.boolean() });

const xaf = z.number({ error: "Le montant est obligatoire." }).int("Montant entier en FCFA.").min(0).max(MAX_XAF_AMOUNT);

/**
 * Dépense de la caisse centrale (docs/modele-donnees.md § 8). Les allocations sont revérifiées par le
 * service : Σ = montant, parts égales recalculées, enfants distincts.
 */
export const expenseSchema = z
  .object({
    spentAt: dateInputSchema("La date de la dépense"),
    categoryId: objectIdSchema,
    amount: xaf.min(1, "Le montant doit être supérieur à 0."),
    description: z.string().trim().min(3, "Décrivez la dépense.").max(2000),
    supplier: optionalText(200),
    reference: optionalText(100),
    scope: z.enum(EXPENSE_SCOPES),
    allocationMode: z.enum(ALLOCATION_MODES).optional(),
    allocations: z.array(z.object({ childId: objectIdSchema, amount: xaf })).max(200, "200 enfants maximum."),
  })
  .superRefine((data, ctx) => {
    const check = checkExpenseAllocations(data.amount, data.scope, data.scope === "COLLECTIVE" ? data.allocationMode : null, data.allocations);
    if (!check.ok) ctx.addIssue({ code: "custom", path: ["allocations"], message: check.message });
  });
export type ExpenseInput = z.input<typeof expenseSchema>;
export type ExpenseData = z.output<typeof expenseSchema>;
