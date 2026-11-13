/**
 * Rôles et permissions.
 *
 * Source de vérité de la matrice décrite dans docs/modele-donnees.md (§ 11).
 * Ce module est pur : le serveur l'utilise pour AUTORISER (services métier), le client uniquement
 * pour adapter l'affichage. Masquer un bouton n'est jamais une mesure de sécurité.
 */

export const ROLES = ["SUPER_ADMIN", "ADMIN", "FINANCE_MANAGER", "CHILD_MANAGER", "MEDIA_MANAGER", "VIDEO_UPLOADER"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Rôles attribuables depuis l'application. Le SUPER_ADMIN est un compte technique : créé uniquement
 * par la commande `create-admin`, invisible dans la liste des utilisateurs et non modifiable depuis
 * l'interface.
 */
export const ASSIGNABLE_ROLES = ["ADMIN", "FINANCE_MANAGER", "CHILD_MANAGER", "MEDIA_MANAGER", "VIDEO_UPLOADER"] as const satisfies readonly Role[];
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super administrateur",
  ADMIN: "Administrateur",
  FINANCE_MANAGER: "Responsable financier",
  CHILD_MANAGER: "Gestionnaire des enfants",
  MEDIA_MANAGER: "Gestionnaire des médias",
  VIDEO_UPLOADER: "Contributeur vidéo",
};

export const PERMISSIONS = [
  "dashboard:read",
  "users:manage",
  "audit:read",
  "settings:manage",
  "data:import", // import Excel (établissements, enfants, sponsors, parrainages) — administrateurs uniquement

  "schoolYears:read",
  "schoolYears:manage", // créer, modifier, activer, clôturer
  "schoolYears:reopen", // réouverture exceptionnelle d'une année clôturée
  "cashbox:initialize", // solde initial de caisse (création unique, correction contrôlée)

  "children:read",
  "children:write",
  "children:archive",
  "schools:write",

  "sponsors:read",
  "sponsors:write",
  "sponsorships:read",
  "sponsorships:write",

  "commitments:read",
  "commitments:write",

  "payments:read",
  "payments:write", // versements, dons, avances, affectation d'avances
  "expenses:read",
  "expenses:write",
  "expenseCategories:manage",
  "finance:cancel", // annulation des mouvements financiers

  "videos:read",
  "videos:upload", // import d'une vidéo (sans mise à disposition ni gestion des liens)
  "videos:write", // mise à disposition, liens, révocation, échéance

  "reports:read",
  "reports:finance",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = PERMISSIONS;

const MATRIX: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  // Décision du 11/11/2026 : l'administrateur dispose de tous les droits du super administrateur.
  ADMIN: ALL,
  FINANCE_MANAGER: [
    "dashboard:read",
    "schoolYears:read",
    "children:read",
    "sponsors:read",
    "sponsors:write",
    "sponsorships:read",
    "sponsorships:write",
    "commitments:read",
    "commitments:write",
    "payments:read",
    "payments:write",
    "expenses:read",
    "expenses:write",
    "expenseCategories:manage",
    "finance:cancel",
    "reports:read",
    "reports:finance",
  ],
  CHILD_MANAGER: [
    "dashboard:read",
    "schoolYears:read",
    "children:read",
    "children:write",
    "children:archive",
    "schools:write",
    "sponsors:read",
    "sponsorships:read",
    "commitments:read",
    "reports:read",
  ],
  MEDIA_MANAGER: [
    "dashboard:read",
    "schoolYears:read",
    "children:read",
    "sponsors:read",
    "sponsorships:read",
    "videos:read",
    "videos:upload",
    "videos:write",
    "reports:read",
  ],
  /** Rôle restreint : importe des vidéos et ne voit rien d'autre (ni liste des vidéos, ni fiches, ni montants). */
  VIDEO_UPLOADER: ["dashboard:read", "videos:upload"],
};

const SETS = new Map<Role, ReadonlySet<Permission>>(ROLES.map((role) => [role, new Set(MATRIX[role])]));

export function hasPermission(role: Role, permission: Permission): boolean {
  return SETS.get(role)?.has(permission) ?? false;
}

export function permissionsOf(role: Role): readonly Permission[] {
  return MATRIX[role];
}
