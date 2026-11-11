/**
 * Tests d'intégration — dépenses et catégories.
 * Base dédiée `parrainage_test_<horodatage>`, supprimée en fin d'exécution.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const TEST_DB = `parrainage_test_${Date.now()}`;
process.env.MONGODB_DB = TEST_DB;

const mongoose = (await import("mongoose")).default;
const { Types } = mongoose;
const { connectDB } = await import("@/lib/db/mongoose");
const { Expense } = await import("@/features/expenses/model");
const { childSchema } = await import("@/features/children/schemas");
const { expenseSchema } = await import("@/features/expenses/schemas");
const children = await import("@/features/children/service");
const expenses = await import("@/features/expenses/service");
const years = await import("@/features/school-years/service");
const { listChildExpenses, listExpenses } = await import("@/features/expenses/queries");
const { computeTreasuryOverview } = await import("@/features/school-years/treasury");
const { BusinessRuleError, ConflictError } = await import("@/lib/errors");
type SessionUser = import("@/features/auth/service").SessionUser;

const actor: SessionUser = {
  id: new Types.ObjectId().toString(),
  sessionId: "s",
  email: "fm@test.local",
  firstName: "Fanny",
  lastName: "Finance",
  name: "Fanny FINANCE",
  role: "SUPER_ADMIN",
  mustChangePassword: false,
};
const ctx = { ip: "127.0.0.1", userAgent: "tests" };
const ids: Record<string, string> = {};
const expense = (overrides: Record<string, unknown>) =>
  expenseSchema.parse({ spentAt: "2026-10-05", categoryId: ids.category, amount: 1000, description: "Fournitures", scope: "GENERAL", allocations: [], ...overrides });

before(async () => {
  const instance = await connectDB();
  assert.equal(instance.connection.name, TEST_DB);
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  ids.year = await years.createSchoolYear(actor, { label: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30" }, ctx);
  await years.activateSchoolYear(actor, ids.year, ctx);
  for (const [key, name] of [["a", "Awa"], ["b", "Binta"], ["c", "Coumba"]]) {
    ids[key] = await children.createChild(actor, childSchema.parse({ firstName: name, lastName: "Test", birthDate: "2014-01-01", sex: "F", guardians: [] }), ctx);
  }
});

after(async () => {
  if (mongoose.connection.name === TEST_DB && /^parrainage_test_\d+$/.test(TEST_DB)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("dépenses", () => {
  it("gère les catégories sans doublon", async () => {
    ids.category = await expenses.createCategory(actor, { name: "Fournitures scolaires", description: undefined }, ctx);
    await assert.rejects(expenses.createCategory(actor, { name: "FOURNITURES SCOLAIRES", description: undefined }, ctx), ConflictError);
  });

  it("répartit une dépense collective à parts égales, le reste au premier enfant (recalculé par le serveur)", async () => {
    // Le client envoie des parts fantaisistes : le serveur recalcule les parts égales.
    const id = await expenses.createExpense(
      actor,
      { ...expense({ amount: 10_000, scope: "COLLECTIVE", allocationMode: "EQUAL", allocations: [{ childId: ids.a, amount: 3_334 }, { childId: ids.b, amount: 3_333 }, { childId: ids.c, amount: 3_333 }] }) },
      ctx,
    );
    const saved = await Expense.findById(id).lean();
    assert.deepEqual(saved?.allocations.map((a) => a.amount), [3_334, 3_333, 3_333]);
    assert.match(saved?.number ?? "", /^DEP-2026-0000\d\d$/);
  });

  it("refuse une répartition manuelle dont la somme diffère et accepte une répartition exacte", () => {
    assert.equal(expenseSchema.safeParse({ spentAt: "2026-10-05", categoryId: ids.category, amount: 9_000, description: "Uniformes", scope: "COLLECTIVE", allocationMode: "MANUAL", allocations: [{ childId: ids.a, amount: 5_000 }, { childId: ids.b, amount: 3_000 }] }).success, false);
    assert.equal(expenseSchema.safeParse({ spentAt: "2026-10-05", categoryId: ids.category, amount: 8_000, description: "Uniformes", scope: "COLLECTIVE", allocationMode: "MANUAL", allocations: [{ childId: ids.a, amount: 5_000 }, { childId: ids.b, amount: 3_000 }] }).success, true);
  });

  it("compte une dépense collective UNE seule fois dans la caisse et les totaux", async () => {
    await expenses.createExpense(actor, expense({ amount: 8_000, scope: "COLLECTIVE", allocationMode: "MANUAL", allocations: [{ childId: ids.a, amount: 5_000 }, { childId: ids.b, amount: 3_000 }] }), ctx);
    await expenses.createExpense(actor, expense({ amount: 2_500, scope: "INDIVIDUAL", allocations: [{ childId: ids.c, amount: 2_500 }] }), ctx);
    const year = (await computeTreasuryOverview()).years.find((y) => y.yearId === ids.year);
    assert.equal(year?.figures.expenses, 20_500); // 10 000 + 8 000 + 2 500, jamais les allocations en plus
    const list = await listExpenses({ page: 1, pageSize: 20, q: "", sort: "spentAt", dir: "desc" }, { yearId: ids.year, categoryId: null, scope: null, status: "ALL" });
    assert.equal(list.totalAmount, 20_500);
    const awa = await listChildExpenses(ids.a);
    assert.deepEqual(awa.map((e) => e.share).sort(), [3_334, 5_000]);
  });

  it("exclut une dépense annulée des totaux et interdit une seconde annulation", async () => {
    const id = await expenses.createExpense(actor, expense({ amount: 999 }), ctx);
    await expenses.cancelExpense(actor, id, "Erreur de saisie", ctx);
    await assert.rejects(expenses.cancelExpense(actor, id, "Encore", ctx), BusinessRuleError);
    assert.equal((await computeTreasuryOverview()).years.find((y) => y.yearId === ids.year)?.figures.expenses, 20_500);
  });

  it("refuse une date future, hors année, ou une catégorie désactivée", async () => {
    await assert.rejects(expenses.createExpense(actor, expense({ spentAt: "2099-01-01" }), ctx), BusinessRuleError);
    await assert.rejects(expenses.createExpense(actor, expense({ spentAt: "2026-08-01" }), ctx), BusinessRuleError);
    await expenses.updateCategory(actor, ids.category, { name: "Fournitures scolaires", description: undefined }, false, ctx);
    await assert.rejects(expenses.createExpense(actor, expense({}), ctx), BusinessRuleError);
  });
});
