/**
 * Tests d'intégration — import Excel « tout ou rien ».
 * Base dédiée `parrainage_test_<horodatage>`, supprimée en fin d'exécution.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const TEST_DB = `parrainage_test_${Date.now()}`;
process.env.MONGODB_DB = TEST_DB;

const mongoose = (await import("mongoose")).default;
const { Types } = mongoose;
const ExcelJS = (await import("exceljs")).default;
const { connectDB } = await import("@/lib/db/mongoose");
const { Child, Enrollment, School } = await import("@/features/children/model");
const { Sponsor } = await import("@/features/sponsors/model");
const { Sponsorship } = await import("@/features/sponsorships/model");
const { Commitment } = await import("@/features/commitments/model");
const { AuditLog } = await import("@/features/audit/model");
const { sponsorSchema } = await import("@/features/sponsors/schemas");
const sponsors = await import("@/features/sponsors/service");
const years = await import("@/features/school-years/service");
const { buildImportTemplate, readImportWorkbook } = await import("@/features/imports/workbook");
const { analyzeImport, runImport } = await import("@/features/imports/service");
const { BusinessRuleError } = await import("@/lib/errors");
type SessionUser = import("@/features/auth/service").SessionUser;

const actor: SessionUser = {
  id: new Types.ObjectId().toString(),
  sessionId: new Types.ObjectId().toString(),
  email: "admin@test.local",
  firstName: "Ada",
  lastName: "Admin",
  name: "Ada ADMIN",
  role: "ADMIN",
  mustChangePassword: false,
};
const ctx = { ip: "127.0.0.1", userAgent: "tests" };

type SheetName = "Établissements" | "Enfants" | "Sponsors" | "Parrainages";
type Rows = Partial<Record<SheetName, Array<Record<string, string | number | Date>>>>;

/** Remplit le modèle officiel (en-têtes réels) avec les lignes fournies ; clé = en-tête sans « * ». */
async function workbook(rows: Rows): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await buildImportTemplate(["2025-2026"])) as unknown as ArrayBuffer);
  for (const [name, lines] of Object.entries(rows)) {
    const sheet = book.getWorksheet(name);
    assert.ok(sheet, `feuille ${name}`);
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, col) => (headers[col - 1] = String(cell.value).replace(" *", "")));
    for (const line of lines ?? []) sheet.addRow(headers.map((h) => line[h] ?? null));
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

const valid: Rows = {
  Établissements: [{ Nom: "École Les Palmiers", Type: "Primaire", Ville: "Douala" }],
  Enfants: [
    {
      "Référence import": "E1",
      Nom: "Mbarga",
      Prénom: "Awa",
      "Date de naissance": new Date(Date.UTC(2014, 1, 1)),
      Sexe: "Fille",
      "Tuteur - lien": "Mère",
      "Tuteur - nom": "Mbarga",
      "Tuteur - prénom": "Rose",
      "Tuteur - téléphone": "+237690000000",
      "Année scolaire": "2025-2026",
      Établissement: "École Les Palmiers",
      Classe: "CM2",
    },
    { "Référence import": "E2", Nom: "Ngono", Prénom: "Paul", "Date de naissance": "03/05/2013", Sexe: "Garçon" },
  ],
  Sponsors: [{ Type: "Particulier", Nom: "Durand", Prénom: "Léa", "E-mail": "lea@durand.fr", Pays: "France" }],
  Parrainages: [
    { "Sponsor (e-mail ou code)": "lea@durand.fr", "Enfant (référence ou code)": "E1", "Année scolaire": "2025-2026", "Montant engagé (FCFA)": 120000 },
    { "Sponsor (e-mail ou code)": "claire@dupont.fr", "Enfant (référence ou code)": "E2", "Année scolaire": "2025-2026" },
  ],
};

before(async () => {
  const instance = await connectDB();
  assert.equal(instance.connection.name, TEST_DB);
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  await years.createSchoolYear(actor, { label: "2025-2026", startDate: "2025-09-01", endDate: "2026-06-30" }, ctx);
  await sponsors.createSponsor(
    actor,
    sponsorSchema.parse({ kind: "PERSON", firstName: "Claire", lastName: "Dupont", email: "claire@dupont.fr", address: { country: "FR" } }),
    ctx,
  );
});

after(async () => {
  if (mongoose.connection.name === TEST_DB && /^parrainage_test_\d+$/.test(TEST_DB)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("import Excel", () => {
  it("relit le modèle téléchargé (feuilles et colonnes reconnues, sans ligne)", async () => {
    const read = await readImportWorkbook(await buildImportTemplate(["2025-2026"]));
    assert.deepEqual(read.errors, []);
    assert.equal(read.totalRows, 0);
  });

  it("refuse un fichier qui n'est pas un classeur", async () => {
    const analysis = await analyzeImport(Buffer.from("pas un xlsx"));
    assert.equal(analysis.ok, false);
    assert.match(analysis.fileErrors[0] ?? "", /classeur Excel/);
  });

  it("bloque tout l'import si une seule ligne est en erreur, sans rien écrire", async () => {
    const broken: Rows = { ...valid, Enfants: [...(valid.Enfants ?? []), { "Référence import": "E3", Nom: "Sans", Prénom: "Date", Sexe: "Fille" }] };
    const buffer = await workbook(broken);
    const analysis = await analyzeImport(buffer);
    assert.equal(analysis.ok, false);
    assert.equal(analysis.sheets.find((s) => s.key === "children")?.errors, 1);
    assert.equal(analysis.issues[0]?.row, 4);
    await assert.rejects(runImport(actor, buffer, "casse.xlsx", ctx), BusinessRuleError);
    assert.equal(await Child.countDocuments(), 0);
    assert.equal(await School.countDocuments(), 0);
  });

  it("signale les références inconnues, pays non reconnus et doublons internes", async () => {
    const analysis = await analyzeImport(
      await workbook({
        Sponsors: [
          { Type: "Particulier", Nom: "A", Prénom: "B", "E-mail": "x@y.fr", Pays: "FR" },
          { Type: "Particulier", Nom: "C", Prénom: "D", "E-mail": "z@y.fr", Pays: "Atlantide" },
          { Type: "Particulier", Nom: "E", Prénom: "F", "E-mail": "x@y.fr", Pays: "FR" },
        ],
        Parrainages: [{ "Sponsor (e-mail ou code)": "inconnu@nulle.part", "Enfant (référence ou code)": "E9", "Année scolaire": "2030-2031" }],
      }),
    );
    assert.equal(analysis.ok, false);
    const messages = analysis.issues.flatMap((i) => i.messages).join(" | ");
    assert.match(messages, /Pays « Atlantide »/);
    assert.match(messages, /présent deux fois/);
    assert.match(messages, /introuvable/);
    assert.match(messages, /2030-2031/);
  });

  it("importe tout dans une transaction (codes, scolarité, tuteur, engagement, audit)", async () => {
    const buffer = await workbook(valid);
    const analysis = await analyzeImport(buffer);
    assert.equal(analysis.ok, true, JSON.stringify([analysis.fileErrors, analysis.issues]));
    assert.deepEqual(analysis.extra, { enrollments: 1, commitments: 1 });

    const result = await runImport(actor, buffer, "reprise.xlsx", ctx);
    assert.deepEqual(result.created, { schools: 1, children: 2, enrollments: 1, sponsors: 1, sponsorships: 2, commitments: 1 });
    const awa = await Child.findOne({ firstName: "Awa" }).lean();
    assert.match(awa?.code ?? "", /^ENF-\d{5}$/);
    assert.equal(awa?.guardians[0]?.relationship, "MOTHER");
    assert.equal(await Enrollment.countDocuments({ child: awa?._id, className: "CM2" }), 1);
    const lea = await Sponsor.findOne({ email: "lea@durand.fr" }).lean();
    assert.equal(lea?.code, "SPN-00002");
    assert.equal(lea?.address?.country, "FR");
    const commitment = await Commitment.findOne({ sponsor: lea?._id }).lean();
    assert.deepEqual({ committed: commitment?.committedAmount, expected: commitment?.expectedAmount }, { committed: 120000, expected: 120000 });
    assert.equal(await Sponsorship.countDocuments(), 2);
    assert.equal(await AuditLog.countDocuments({ action: "import.run" }), 1);
  });

  it("ignore les lignes déjà présentes : un ré-import ne crée aucun doublon", async () => {
    const analysis = await analyzeImport(await workbook(valid));
    assert.equal(analysis.ok, false);
    assert.equal(analysis.sheets.reduce((sum, s) => sum + s.create, 0), 0);
    assert.equal(analysis.sheets.reduce((sum, s) => sum + s.skip, 0), 6);
    assert.match(analysis.fileErrors[0] ?? "", /Aucune nouvelle donnée/);
    assert.equal(await Child.countDocuments(), 2);
  });
});
