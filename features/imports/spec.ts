/**
 * Spécification de l'import Excel : une seule source pour le modèle téléchargeable ET la lecture
 * des fichiers reçus (mêmes feuilles, mêmes colonnes, mêmes listes de valeurs).
 *
 * Ordre de traitement : Établissements → Enfants (+ scolarité) → Sponsors → Parrainages (+ engagement).
 * Aucun mouvement financier n'est importable : l'historique de caisse passe par le solde initial.
 */

import { GUARDIAN_RELATIONSHIP_LABELS, SCHOOL_TYPE_LABELS, SEX_LABELS } from "@/features/children/types";
import { SPONSOR_KIND_LABELS } from "@/features/sponsors/types";

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 2000;

export type ImportColumn = {
  key: string;
  header: string;
  required?: boolean;
  /** Liste fermée proposée dans le modèle (liste déroulante). */
  list?: "schoolTypes" | "sexes" | "relationships" | "sponsorKinds" | "countries" | "years";
  kind?: "text" | "date" | "amount";
  width?: number;
  help: string;
};

export type ImportSheetKey = "schools" | "children" | "sponsors" | "sponsorships";
export type ImportSheet = { key: ImportSheetKey; name: string; description: string; columns: ImportColumn[] };

export const IMPORT_SHEETS: ImportSheet[] = [
  {
    key: "schools",
    name: "Établissements",
    description: "Établissements fréquentés. Un établissement déjà enregistré (même nom, même ville) est ignoré.",
    columns: [
      { key: "name", header: "Nom", required: true, width: 32, help: "Nom de l'établissement." },
      { key: "type", header: "Type", required: true, list: "schoolTypes", width: 20, help: "Maternelle, Primaire, Collège, Lycée…" },
      { key: "city", header: "Ville", width: 18, help: "Ville (sert à distinguer deux établissements homonymes)." },
      { key: "address", header: "Adresse", width: 28, help: "Facultatif." },
      { key: "phone", header: "Téléphone", width: 18, help: "Facultatif." },
      { key: "email", header: "E-mail", width: 26, help: "Facultatif." },
    ],
  },
  {
    key: "children",
    name: "Enfants",
    description: "Une ligne par enfant. Un enfant déjà enregistré (même nom, prénom et date de naissance) est ignoré, mais reste utilisable dans la feuille Parrainages via sa référence.",
    columns: [
      { key: "ref", header: "Référence import", required: true, width: 16, help: "Identifiant libre et unique dans le fichier (ex. E001), utilisé par la feuille Parrainages." },
      { key: "lastName", header: "Nom", required: true, width: 18, help: "" },
      { key: "firstName", header: "Prénom", required: true, width: 18, help: "" },
      { key: "birthDate", header: "Date de naissance", required: true, kind: "date", width: 16, help: "Date Excel ou JJ/MM/AAAA." },
      { key: "sex", header: "Sexe", required: true, list: "sexes", width: 10, help: "Fille ou Garçon." },
      { key: "birthPlace", header: "Lieu de naissance", width: 18, help: "Facultatif." },
      { key: "address", header: "Adresse / quartier", width: 24, help: "Facultatif." },
      { key: "city", header: "Ville", width: 16, help: "Facultatif." },
      { key: "phone", header: "Téléphone", width: 16, help: "Facultatif." },
      { key: "email", header: "E-mail", width: 22, help: "Facultatif." },
      { key: "guardianRelationship", header: "Tuteur - lien", list: "relationships", width: 16, help: "Mère, Père, Tuteur / tutrice… (si un tuteur est renseigné)." },
      { key: "guardianLastName", header: "Tuteur - nom", width: 18, help: "Contact principal de la famille." },
      { key: "guardianFirstName", header: "Tuteur - prénom", width: 18, help: "" },
      { key: "guardianPhone", header: "Tuteur - téléphone", width: 18, help: "" },
      { key: "guardianEmail", header: "Tuteur - e-mail", width: 22, help: "" },
      { key: "year", header: "Année scolaire", list: "years", width: 14, help: "Ex. 2025-2026. Si renseignée, Établissement et Classe sont obligatoires." },
      { key: "school", header: "Établissement", width: 28, help: "Nom exact d'un établissement existant ou de la feuille Établissements." },
      { key: "schoolCity", header: "Ville de l'établissement", width: 18, help: "Nécessaire si deux établissements portent le même nom." },
      { key: "className", header: "Classe", width: 10, help: "Ex. CM2, 6e." },
      { key: "notes", header: "Notes", width: 30, help: "Facultatif." },
    ],
  },
  {
    key: "sponsors",
    name: "Sponsors",
    description: "Une ligne par sponsor. Un sponsor déjà enregistré avec le même e-mail est ignoré.",
    columns: [
      { key: "kind", header: "Type", required: true, list: "sponsorKinds", width: 14, help: "Particulier ou Organisation." },
      { key: "lastName", header: "Nom", width: 18, help: "Obligatoire pour un particulier." },
      { key: "firstName", header: "Prénom", width: 18, help: "Obligatoire pour un particulier." },
      { key: "organizationName", header: "Organisation", width: 26, help: "Obligatoire pour une organisation." },
      { key: "email", header: "E-mail", width: 26, help: "Fortement recommandé : sert à reconnaître le sponsor (et dans la feuille Parrainages)." },
      { key: "phone", header: "Téléphone", width: 18, help: "E-mail ou téléphone obligatoire." },
      { key: "secondaryPhone", header: "Téléphone 2", width: 18, help: "Facultatif." },
      { key: "country", header: "Pays", required: true, list: "countries", width: 18, help: "Nom du pays (ex. France) ou code ISO (FR)." },
      { key: "city", header: "Ville", width: 16, help: "" },
      { key: "postalCode", header: "Code postal", width: 12, help: "" },
      { key: "address", header: "Adresse", width: 28, help: "" },
      { key: "notes", header: "Notes", width: 30, help: "" },
    ],
  },
  {
    key: "sponsorships",
    name: "Parrainages",
    description: "Une ligne par parrainage (sponsor × enfant × année), avec le montant engagé éventuel. Un parrainage déjà existant est ignoré.",
    columns: [
      { key: "sponsor", header: "Sponsor (e-mail ou code)", required: true, width: 28, help: "E-mail du sponsor (feuille Sponsors ou déjà enregistré) ou son code SPN-…" },
      { key: "child", header: "Enfant (référence ou code)", required: true, width: 22, help: "Référence import de la feuille Enfants, ou code ENF-… d'un enfant déjà enregistré." },
      { key: "year", header: "Année scolaire", required: true, list: "years", width: 14, help: "Année existante et non clôturée." },
      { key: "startDate", header: "Date de début", kind: "date", width: 14, help: "Facultatif : début de l'année par défaut." },
      { key: "amount", header: "Montant engagé (FCFA)", kind: "amount", width: 20, help: "Facultatif : crée l'engagement financier du parrainage." },
    ],
  },
];

export const LIST_VALUES = {
  schoolTypes: Object.values(SCHOOL_TYPE_LABELS),
  sexes: Object.values(SEX_LABELS),
  relationships: Object.values(GUARDIAN_RELATIONSHIP_LABELS),
  sponsorKinds: Object.values(SPONSOR_KIND_LABELS),
} as const;

/* ------------------------------------------------------------------ Résultats (partagés avec l'interface) */

export type ImportIssue = { sheet: string; row: number; messages: string[] };
export type ImportSheetSummary = { key: ImportSheetKey; name: string; rows: number; create: number; skip: number; errors: number };
export type ImportAnalysis = {
  ok: boolean;
  /** Erreurs bloquantes globales (fichier illisible, feuille ou colonne manquante…). */
  fileErrors: string[];
  sheets: ImportSheetSummary[];
  issues: ImportIssue[];
  /** Informations non bloquantes (lignes ignorées car déjà présentes…). */
  notices: ImportIssue[];
  extra: { enrollments: number; commitments: number };
};
export type ImportResult = {
  created: { schools: number; children: number; enrollments: number; sponsors: number; sponsorships: number; commitments: number };
  skipped: number;
  report: Array<{ sheet: string; row: number; status: "Créé" | "Ignoré"; detail: string }>;
};
