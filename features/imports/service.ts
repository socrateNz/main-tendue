import "server-only";

import { type ClientSession, Types } from "mongoose";

import { actorOf, type RequestContext, type SessionUser } from "@/features/auth/service";
import { Child, Enrollment, School, childIdentityKey } from "@/features/children/model";
import { childSchema, schoolSchema, type ChildData, type SchoolData } from "@/features/children/schemas";
import { GUARDIAN_RELATIONSHIP_LABELS, SCHOOL_TYPE_LABELS, SEX_LABELS } from "@/features/children/types";
import { Commitment } from "@/features/commitments/model";
import { SchoolYear } from "@/features/school-years/model";
import { Sponsor } from "@/features/sponsors/model";
import { sponsorSchema, type SponsorData } from "@/features/sponsors/schemas";
import { SPONSOR_KIND_LABELS, sponsorDisplayName } from "@/features/sponsors/types";
import { Sponsorship } from "@/features/sponsorships/model";
import { recordAudit } from "@/lib/audit";
import { formatNumber, reserveSequence } from "@/lib/db/counter";
import { connectDB, withTransaction } from "@/lib/db/mongoose";
import { isWithinPeriod, parseDateInput, toDateInput } from "@/lib/dates";
import { BusinessRuleError } from "@/lib/errors";
import { MAX_XAF_AMOUNT } from "@/lib/money";
import { fullName, normalizeSearch } from "@/lib/text";

import { amountValue, codeFromLabel, countryValue, dateValue, text } from "./convert";
import { IMPORT_SHEETS, type ImportAnalysis, type ImportIssue, type ImportResult, type ImportSheetKey } from "./spec";
import { readImportWorkbook, type RawRow, type ReadResult } from "./workbook";

/**
 * Import Excel en deux temps :
 *  1. ANALYSE (aucune écriture) : chaque ligne passe par les mêmes validations Zod que la saisie
 *     manuelle ; les références sont résolues dans la base ET dans le fichier.
 *  2. EXÉCUTION : le plan est recalculé DANS une transaction unique, puis appliqué. La moindre erreur
 *     annule tout (règle validée : tout ou rien). Les lignes déjà présentes sont ignorées, ce qui
 *     rend un ré-import du même fichier sans effet.
 */

const MAX_ISSUES = 500;
const sheetName = (key: ImportSheetKey) => IMPORT_SHEETS.find((s) => s.key === key)?.name ?? key;
const schoolKey = (name: string, city: string) => normalizeSearch(`${name}|${city}`);

type Year = { id: Types.ObjectId; label: string; status: string; startDate: Date; endDate: Date };
type SchoolRef = { existingId?: Types.ObjectId; newKey?: string; inactive?: boolean };
type ChildRef = { existingId?: Types.ObjectId; status?: string; newRef?: string };
type SponsorRef = { existingId?: Types.ObjectId; status?: string; newKey?: string };

type Plan = {
  schools: Array<{ row: number; key: string; data: SchoolData }>;
  children: Array<{ row: number; ref: string; data: ChildData; enrollment: { yearId: Types.ObjectId; school: SchoolRef; className: string } | null }>;
  sponsors: Array<{ row: number; key: string; data: SponsorData }>;
  sponsorships: Array<{ row: number; sponsor: SponsorRef; child: ChildRef; year: Year; startDate: Date; amount: number | null }>;
  issues: ImportIssue[];
  notices: ImportIssue[];
  counts: Record<ImportSheetKey, { rows: number; create: number; skip: number; errors: number }>;
};

function zodMessages(error: { issues: Array<{ path: PropertyKey[]; message: string }> }, labels: Record<string, string>): string[] {
  return error.issues.map((issue) => {
    const field = labels[String(issue.path[0] ?? "")];
    return field ? `${field} : ${issue.message}` : issue.message;
  });
}

const read = <T,>(session: ClientSession | undefined, query: { session: (s: ClientSession | null) => T }) => query.session(session ?? null);

async function buildPlan(sheets: ReadResult["sheets"], session?: ClientSession): Promise<Plan> {
  const counts = Object.fromEntries(IMPORT_SHEETS.map((s) => [s.key, { rows: sheets[s.key]?.length ?? 0, create: 0, skip: 0, errors: 0 }])) as Plan["counts"];
  const plan: Plan = { schools: [], children: [], sponsors: [], sponsorships: [], issues: [], notices: [], counts };
  const fail = (key: ImportSheetKey, row: number, messages: string[]) => {
    counts[key].errors += 1;
    if (plan.issues.length < MAX_ISSUES) plan.issues.push({ sheet: sheetName(key), row, messages });
  };
  const skip = (key: ImportSheetKey, row: number, message: string) => {
    counts[key].skip += 1;
    if (plan.notices.length < MAX_ISSUES) plan.notices.push({ sheet: sheetName(key), row, messages: [message] });
  };

  // Référentiels (lectures successives : compatibles avec une transaction).
  const years: Year[] = (await read(session, SchoolYear.find({}, { label: 1, status: 1, startDate: 1, endDate: 1 })).lean()).map((y) => ({
    id: y._id,
    label: y.label,
    status: y.status,
    startDate: y.startDate,
    endDate: y.endDate,
  }));
  const yearByLabel = new Map(years.map((y) => [normalizeSearch(y.label), y]));
  const existingSchools = await read(session, School.find({}, { name: 1, city: 1, uniqueKey: 1, active: 1 })).lean();

  /* ---------------- Établissements ---------------- */
  const schoolsByKey = new Map<string, SchoolRef>(existingSchools.map((s) => [s.uniqueKey, { existingId: s._id, inactive: !s.active }]));
  const schoolsByName = new Map<string, SchoolRef[]>();
  const addByName = (name: string, ref: SchoolRef) => schoolsByName.set(normalizeSearch(name), [...(schoolsByName.get(normalizeSearch(name)) ?? []), ref]);
  existingSchools.filter((s) => s.active).forEach((s) => addByName(s.name, { existingId: s._id }));

  for (const { row, values } of sheets.schools ?? []) {
    const type = codeFromLabel(values.type, SCHOOL_TYPE_LABELS);
    const parsed = schoolSchema.safeParse({ name: text(values.name), type: type ?? text(values.type), city: text(values.city), address: text(values.address), phone: text(values.phone), email: text(values.email) });
    if (!parsed.success) {
      fail("schools", row, zodMessages(parsed.error, { name: "Nom", type: "Type", city: "Ville", phone: "Téléphone", email: "E-mail", address: "Adresse" }));
      continue;
    }
    const key = schoolKey(parsed.data.name, parsed.data.city ?? "");
    const known = schoolsByKey.get(key);
    if (known?.existingId) {
      skip("schools", row, "Établissement déjà enregistré : ligne ignorée.");
      continue;
    }
    if (known?.newKey) {
      fail("schools", row, ["Établissement présent deux fois dans le fichier (même nom, même ville)."]);
      continue;
    }
    schoolsByKey.set(key, { newKey: key });
    addByName(parsed.data.name, { newKey: key });
    plan.schools.push({ row, key, data: parsed.data });
    counts.schools.create += 1;
  }

  /* ---------------- Enfants (+ scolarité) ---------------- */
  const childRows = sheets.children ?? [];
  const identityKeys = childRows.map((r) => childIdentityKey(text(r.values.firstName), text(r.values.lastName)));
  const existingChildren = identityKeys.length
    ? await read(session, Child.find({ identityKey: { $in: identityKeys } }, { identityKey: 1, birthDate: 1, status: 1 })).lean()
    : [];
  const childByRef = new Map<string, ChildRef>();
  const seenIdentity = new Set<string>();

  for (const { row, values } of childRows) {
    const messages: string[] = [];
    const ref = text(values.ref);
    if (!ref) messages.push("Référence import : obligatoire.");
    else if (childByRef.has(normalizeSearch(ref))) messages.push(`Référence import « ${ref} » utilisée plusieurs fois.`);

    const birthDate = dateValue(values.birthDate);
    if (values.birthDate !== null && values.birthDate !== undefined && !birthDate) messages.push("Date de naissance : format non reconnu (JJ/MM/AAAA).");
    const sex = codeFromLabel(values.sex, SEX_LABELS);
    const hasGuardian = [values.guardianLastName, values.guardianFirstName, values.guardianPhone, values.guardianEmail].some((v) => text(v));
    const relationship = codeFromLabel(values.guardianRelationship, GUARDIAN_RELATIONSHIP_LABELS) ?? (hasGuardian ? "GUARDIAN" : null);
    const parsed = childSchema.safeParse({
      firstName: text(values.firstName),
      lastName: text(values.lastName),
      birthDate: birthDate ?? "",
      sex: sex ?? text(values.sex),
      birthPlace: text(values.birthPlace),
      address: text(values.address),
      city: text(values.city),
      phone: text(values.phone),
      email: text(values.email),
      notes: text(values.notes),
      guardians: hasGuardian
        ? [{ relationship, firstName: text(values.guardianFirstName), lastName: text(values.guardianLastName), phone: text(values.guardianPhone), email: text(values.guardianEmail), isPrimaryContact: true }]
        : [],
    });
    if (!parsed.success) {
      messages.push(
        ...zodMessages(parsed.error, { firstName: "Prénom", lastName: "Nom", birthDate: "Date de naissance", sex: "Sexe", phone: "Téléphone", email: "E-mail", guardians: "Tuteur" }),
      );
    }

    // Scolarité de l'année (facultative).
    let enrollment: Plan["children"][number]["enrollment"] = null;
    const yearLabel = text(values.year);
    if (yearLabel) {
      const year = yearByLabel.get(normalizeSearch(yearLabel));
      const schoolName = text(values.school);
      const className = text(values.className);
      if (!year) messages.push(`Année scolaire « ${yearLabel} » inconnue.`);
      if (!schoolName) messages.push("Établissement : obligatoire lorsque l'année scolaire est renseignée.");
      if (!className) messages.push("Classe : obligatoire lorsque l'année scolaire est renseignée.");
      let school: SchoolRef | undefined;
      if (schoolName) {
        const city = text(values.schoolCity);
        school = city ? schoolsByKey.get(schoolKey(schoolName, city)) : undefined;
        if (!city) {
          const candidates = schoolsByName.get(normalizeSearch(schoolName)) ?? [];
          if (candidates.length > 1) messages.push(`Plusieurs établissements s'appellent « ${schoolName} » : précisez la ville.`);
          else school = candidates[0];
        }
        if (!school && !messages.some((m) => m.startsWith("Plusieurs"))) messages.push(`Établissement « ${schoolName} » introuvable (ni enregistré, ni dans la feuille Établissements).`);
      }
      if (school?.inactive) messages.push(`L'établissement « ${schoolName} » est désactivé.`);
      if (year && school && !school.inactive && className) enrollment = { yearId: year.id, school, className: className.slice(0, 50) };
    }

    if (messages.length || !parsed.success) {
      fail("children", row, messages);
      if (ref) childByRef.set(normalizeSearch(ref), {}); // réservée : évite des erreurs en cascade trompeuses
      continue;
    }
    const identity = `${childIdentityKey(parsed.data.firstName, parsed.data.lastName)}|${parsed.data.birthDate}`;
    const existing = existingChildren.find((c) => `${c.identityKey}|${toDateInput(c.birthDate)}` === identity);
    if (existing) {
      childByRef.set(normalizeSearch(ref), { existingId: existing._id, status: existing.status });
      skip("children", row, `${fullName(parsed.data)} est déjà enregistré(e) : ligne ignorée (référence utilisable pour les parrainages).`);
      continue;
    }
    if (seenIdentity.has(identity)) {
      fail("children", row, ["Même enfant (nom, prénom, date de naissance) présent deux fois dans le fichier."]);
      continue;
    }
    seenIdentity.add(identity);
    childByRef.set(normalizeSearch(ref), { newRef: normalizeSearch(ref) });
    plan.children.push({ row, ref: normalizeSearch(ref), data: parsed.data, enrollment });
    counts.children.create += 1;
  }

  /* ---------------- Sponsors ---------------- */
  const sponsorRows = sheets.sponsors ?? [];
  const emails = sponsorRows.map((r) => text(r.values.email).toLowerCase()).filter(Boolean);
  const existingSponsors = emails.length ? await read(session, Sponsor.find({ email: { $in: emails } }, { email: 1, status: 1 })).lean() : [];
  const sponsorByEmail = new Map<string, SponsorRef>(existingSponsors.map((s) => [s.email ?? "", { existingId: s._id, status: s.status }]));

  for (const { row, values } of sponsorRows) {
    const kind = codeFromLabel(values.kind, SPONSOR_KIND_LABELS);
    const country = countryValue(values.country);
    const messages: string[] = [];
    if (text(values.country) && !country) messages.push(`Pays « ${text(values.country)} » non reconnu (nom en français ou code ISO, ex. FR).`);
    const parsed = sponsorSchema.safeParse({
      kind: kind ?? text(values.kind),
      firstName: text(values.firstName),
      lastName: text(values.lastName),
      organizationName: text(values.organizationName),
      email: text(values.email),
      phone: text(values.phone),
      secondaryPhone: text(values.secondaryPhone),
      address: { line1: text(values.address), line2: "", postalCode: text(values.postalCode), city: text(values.city), country: country ?? "" },
      notes: text(values.notes),
    });
    if (!parsed.success) {
      messages.push(...zodMessages(parsed.error, { kind: "Type", lastName: "Nom", firstName: "Prénom", organizationName: "Organisation", email: "E-mail", phone: "Téléphone", address: "Pays" }));
    }
    if (messages.length || !parsed.success) {
      fail("sponsors", row, [...new Set(messages)]);
      continue;
    }
    const email = parsed.data.email;
    const key = email ?? `sans-email:${row}`;
    if (email) {
      const known = sponsorByEmail.get(email);
      if (known?.existingId) {
        skip("sponsors", row, `Sponsor ${email} déjà enregistré : ligne ignorée.`);
        continue;
      }
      if (known?.newKey) {
        fail("sponsors", row, [`E-mail ${email} présent deux fois dans le fichier.`]);
        continue;
      }
      sponsorByEmail.set(email, { newKey: key });
    }
    plan.sponsors.push({ row, key, data: parsed.data });
    counts.sponsors.create += 1;
  }

  /* ---------------- Parrainages (+ engagement) ---------------- */
  const sponsorshipRows = sheets.sponsorships ?? [];
  const codes = sponsorshipRows.map((r) => text(r.values.sponsor).toUpperCase()).filter((v) => v.startsWith("SPN-"));
  const childCodes = sponsorshipRows.map((r) => text(r.values.child).toUpperCase()).filter((v) => v.startsWith("ENF-"));
  const moreEmails = sponsorshipRows.map((r) => text(r.values.sponsor).toLowerCase()).filter((v) => v.includes("@") && !sponsorByEmail.has(v));
  const [sponsorsByCode, sponsorsByOtherEmail, childrenByCode] = [
    codes.length ? await read(session, Sponsor.find({ code: { $in: codes } }, { code: 1, status: 1 })).lean() : [],
    moreEmails.length ? await read(session, Sponsor.find({ email: { $in: moreEmails } }, { email: 1, status: 1 })).lean() : [],
    childCodes.length ? await read(session, Child.find({ code: { $in: childCodes } }, { code: 1, status: 1 })).lean() : [],
  ];
  sponsorsByOtherEmail.forEach((s) => sponsorByEmail.set(s.email ?? "", { existingId: s._id, status: s.status }));
  const seenPairs = new Set<string>();
  const pending: Array<Plan["sponsorships"][number] & { pair?: string }> = [];

  for (const { row, values } of sponsorshipRows) {
    const messages: string[] = [];
    const sponsorValue = text(values.sponsor);
    const sponsor: SponsorRef | undefined = sponsorValue.includes("@")
      ? sponsorByEmail.get(sponsorValue.toLowerCase())
      : (() => {
          const found = sponsorsByCode.find((s) => s.code === sponsorValue.toUpperCase());
          return found ? { existingId: found._id, status: found.status } : undefined;
        })();
    if (!sponsorValue) messages.push("Sponsor : obligatoire.");
    else if (!sponsor) messages.push(`Sponsor « ${sponsorValue} » introuvable (ni enregistré, ni dans la feuille Sponsors).`);
    else if (sponsor.existingId && sponsor.status !== "ACTIVE") messages.push(`Le sponsor « ${sponsorValue} » n'est pas actif.`);

    const childValue = text(values.child);
    const child: ChildRef | undefined = childValue.toUpperCase().startsWith("ENF-")
      ? (() => {
          const found = childrenByCode.find((c) => c.code === childValue.toUpperCase());
          return found ? { existingId: found._id, status: found.status } : undefined;
        })()
      : childByRef.get(normalizeSearch(childValue));
    if (!childValue) messages.push("Enfant : obligatoire.");
    else if (!child) messages.push(`Enfant « ${childValue} » introuvable (référence de la feuille Enfants ou code ENF-…).`);
    else if (!child.existingId && !child.newRef) messages.push(`L'enfant « ${childValue} » est en erreur dans la feuille Enfants.`);
    else if (child.existingId && child.status !== "ACTIVE") messages.push(`La fiche de l'enfant « ${childValue} » est archivée.`);

    const year = yearByLabel.get(normalizeSearch(text(values.year)));
    if (!text(values.year)) messages.push("Année scolaire : obligatoire.");
    else if (!year) messages.push(`Année scolaire « ${text(values.year)} » inconnue.`);
    else if (year.status === "CLOSED") messages.push(`L'année ${year.label} est clôturée.`);

    const start = values.startDate !== null && values.startDate !== undefined ? dateValue(values.startDate) : year ? toDateInput(year.startDate) : null;
    if (values.startDate !== null && values.startDate !== undefined && !start) messages.push("Date de début : format non reconnu (JJ/MM/AAAA).");
    const startDate = start ? parseDateInput(start) : null;
    if (year && startDate && !isWithinPeriod(startDate, year.startDate, year.endDate)) messages.push(`Date de début hors de l'année ${year.label}.`);

    const amount = amountValue(values.amount);
    if (amount !== null && (Number.isNaN(amount) || amount < 1 || amount > MAX_XAF_AMOUNT)) messages.push("Montant engagé : nombre entier de FCFA supérieur à 0.");

    if (messages.length || !sponsor || !child || !year || !startDate) {
      fail("sponsorships", row, messages);
      continue;
    }
    const pair = `${sponsor.existingId?.toString() ?? `new:${sponsor.newKey}`}|${child.existingId?.toString() ?? `new:${child.newRef}`}|${year.id.toString()}`;
    if (seenPairs.has(pair)) {
      fail("sponsorships", row, ["Même parrainage (sponsor, enfant, année) présent deux fois dans le fichier."]);
      continue;
    }
    seenPairs.add(pair);
    pending.push({ row, sponsor, child, year, startDate, amount, pair });
  }

  // Parrainages déjà existants (sponsor et enfant déjà enregistrés) : ignorés.
  const knownSponsors = pending.flatMap((p) => (p.sponsor.existingId && p.child.existingId ? [p.sponsor.existingId] : []));
  const knownChildren = pending.flatMap((p) => (p.sponsor.existingId && p.child.existingId ? [p.child.existingId] : []));
  const existingSponsorships = knownSponsors.length
    ? await read(session, Sponsorship.find({ sponsor: { $in: knownSponsors }, child: { $in: knownChildren } }, { sponsor: 1, child: 1, schoolYear: 1 })).lean()
    : [];
  const existingPairs = new Set(existingSponsorships.map((s) => `${s.sponsor.toString()}|${s.child.toString()}|${s.schoolYear.toString()}`));
  for (const item of pending) {
    if (existingPairs.has(item.pair ?? "")) {
      skip("sponsorships", item.row, "Parrainage déjà enregistré : ligne ignorée.");
      continue;
    }
    plan.sponsorships.push({ row: item.row, sponsor: item.sponsor, child: item.child, year: item.year, startDate: item.startDate, amount: item.amount });
    counts.sponsorships.create += 1;
  }

  return plan;
}

function toAnalysis(plan: Plan, fileErrors: string[]): ImportAnalysis {
  const sheets = IMPORT_SHEETS.map((s) => ({ key: s.key, name: s.name, ...plan.counts[s.key] }));
  const hasErrors = fileErrors.length > 0 || sheets.some((s) => s.errors > 0);
  const toCreate = sheets.reduce((sum, s) => sum + s.create, 0);
  return {
    ok: !hasErrors && toCreate > 0,
    fileErrors: !hasErrors && toCreate === 0 && fileErrors.length === 0 ? ["Aucune nouvelle donnée à importer : toutes les lignes sont déjà présentes ou le fichier est vide."] : fileErrors,
    sheets,
    issues: plan.issues,
    notices: plan.notices,
    extra: { enrollments: plan.children.filter((c) => c.enrollment).length, commitments: plan.sponsorships.filter((s) => s.amount).length },
  };
}

const emptyPlan = (): Plan => ({
  schools: [],
  children: [],
  sponsors: [],
  sponsorships: [],
  issues: [],
  notices: [],
  counts: Object.fromEntries(IMPORT_SHEETS.map((s) => [s.key, { rows: 0, create: 0, skip: 0, errors: 0 }])) as Plan["counts"],
});

/** Analyse sans aucune écriture. */
export async function analyzeImport(buffer: Buffer): Promise<ImportAnalysis> {
  const parsed = await readImportWorkbook(buffer);
  if (parsed.errors.length) return toAnalysis(emptyPlan(), parsed.errors);
  await connectDB();
  return toAnalysis(await buildPlan(parsed.sheets), []);
}

/** Exécution « tout ou rien » : plan recalculé et appliqué dans une transaction unique. */
export async function runImport(actor: SessionUser, buffer: Buffer, fileName: string, ctx: RequestContext): Promise<ImportResult> {
  const parsed = await readImportWorkbook(buffer);
  if (parsed.errors.length) throw new BusinessRuleError(parsed.errors.join(" "));

  return withTransaction(async (session) => {
    const plan = await buildPlan(parsed.sheets, session);
    const analysis = toAnalysis(plan, []);
    if (!analysis.ok) throw new BusinessRuleError("Le fichier contient des erreurs ou aucune donnée nouvelle : relancez l'analyse. Aucune donnée n'a été importée.");
    const actorId = new Types.ObjectId(actor.id);
    const report: ImportResult["report"] = plan.notices.map((n) => ({ sheet: n.sheet, row: n.row, status: "Ignoré" as const, detail: n.messages.join(" ") }));

    // Établissements
    const schoolIds = new Map<string, Types.ObjectId>();
    for (const item of plan.schools) {
      const [school] = await School.create([item.data], { session });
      schoolIds.set(item.key, school._id);
      report.push({ sheet: sheetName("schools"), row: item.row, status: "Créé", detail: item.data.name });
    }
    const resolveSchool = (ref: SchoolRef) => ref.existingId ?? (ref.newKey ? schoolIds.get(ref.newKey) : undefined);

    // Enfants + scolarité
    const childIds = new Map<string, Types.ObjectId>();
    let childSeq = await reserveSequence("child", plan.children.length, session);
    let enrollments = 0;
    for (const item of plan.children) {
      const code = formatNumber("ENF", childSeq++, 5);
      const birthDate = parseDateInput(item.data.birthDate);
      if (!birthDate) throw new BusinessRuleError("Date de naissance invalide pendant l'import.");
      const [child] = await Child.create([{ ...item.data, birthDate, code, createdBy: actorId }], { session });
      childIds.set(item.ref, child._id);
      if (item.enrollment) {
        const school = resolveSchool(item.enrollment.school);
        if (!school) throw new BusinessRuleError("Établissement introuvable pendant l'import.");
        await Enrollment.create([{ child: child._id, schoolYear: item.enrollment.yearId, school, className: item.enrollment.className, outcome: "PENDING" }], { session });
        enrollments += 1;
      }
      report.push({ sheet: sheetName("children"), row: item.row, status: "Créé", detail: `${fullName(item.data)} (${code})` });
    }

    // Sponsors
    const sponsorIds = new Map<string, Types.ObjectId>();
    let sponsorSeq = await reserveSequence("sponsor", plan.sponsors.length, session);
    for (const item of plan.sponsors) {
      const code = formatNumber("SPN", sponsorSeq++, 5);
      const data = item.data;
      const person = data.kind === "PERSON";
      const [sponsor] = await Sponsor.create(
        [
          {
            kind: data.kind,
            firstName: person ? data.firstName : undefined,
            lastName: person ? data.lastName : undefined,
            organizationName: person ? undefined : data.organizationName,
            email: data.email,
            phone: data.phone,
            secondaryPhone: data.secondaryPhone,
            address: data.address,
            notes: data.notes,
            code,
            createdBy: actorId,
          },
        ],
        { session },
      );
      sponsorIds.set(item.key, sponsor._id);
      report.push({ sheet: sheetName("sponsors"), row: item.row, status: "Créé", detail: `${sponsorDisplayName(data)} (${code})` });
    }

    // Parrainages + engagements
    let commitments = 0;
    for (const item of plan.sponsorships) {
      const sponsorId = item.sponsor.existingId ?? (item.sponsor.newKey ? sponsorIds.get(item.sponsor.newKey) : undefined);
      const childId = item.child.existingId ?? (item.child.newRef ? childIds.get(item.child.newRef) : undefined);
      if (!sponsorId || !childId) throw new BusinessRuleError("Référence introuvable pendant l'import.");
      const [sponsorship] = await Sponsorship.create(
        [{ sponsor: sponsorId, child: childId, schoolYear: item.year.id, startDate: item.startDate, status: "ACTIVE", createdBy: actorId }],
        { session },
      );
      if (item.amount) {
        await Commitment.create(
          [{ sponsorship: sponsorship._id, sponsor: sponsorId, child: childId, schoolYear: item.year.id, committedAmount: item.amount, expectedAmount: item.amount, createdBy: actorId }],
          { session },
        );
        commitments += 1;
      }
      report.push({ sheet: sheetName("sponsorships"), row: item.row, status: "Créé", detail: `Année ${item.year.label}${item.amount ? `, engagement ${item.amount} FCFA` : ""}` });
    }

    const created = {
      schools: plan.schools.length,
      children: plan.children.length,
      enrollments,
      sponsors: plan.sponsors.length,
      sponsorships: plan.sponsorships.length,
      commitments,
    };
    await recordAudit(actorOf(actor, ctx), {
      action: "import.run",
      summary: `Import Excel « ${fileName.slice(0, 80)} » : ${created.schools} établissement(s), ${created.children} enfant(s), ${created.sponsors} sponsor(s), ${created.sponsorships} parrainage(s), ${created.commitments} engagement(s) ; ${plan.notices.length} ligne(s) ignorée(s).`,
      entityType: "Import",
      details: { fileName: fileName.slice(0, 200), created, skipped: plan.notices.length },
    }, session);

    return { created, skipped: plan.notices.length, report: report.sort((a, b) => a.sheet.localeCompare(b.sheet) || a.row - b.row) };
  });
}

export type { RawRow };
