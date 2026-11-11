/**
 * Rôles et permissions.
 *
 * Source de vérité de la matrice décrite dans docs/modele-donnees.md (§ 11).
 * Ce module est pur : le serveur l'utilise pour AUTORISER (services métier), le client uniquement
 * pour adapter l'affichage. Masquer un bouton n'est jamais une mesure de sécurité.
 */

export const ROLES = ["SUPER_ADMIN", "ADMIN", "FINANCE_MANAGER", "CHILD_MANAGER", "MEDIA_MANAGER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super administrateur",
  ADMIN: "Administrateur",
  FINANCE_MANAGER: "Responsable financier",
  CHILD_MANAGER: "Gestionnaire des enfants",
  MEDIA_MANAGER: "Gestionnaire des médias",
};

export const PERMISSIONS = [
  "dashboard:read",
  "users:manage",
  "audit:read",
  "settings:manage",

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
  "videos:write", // import, liens, révocation, échéance

  "reports:read",
  "reports:finance",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = PERMISSIONS;

const MATRIX: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  ADMIN: ALL.filter(
    (p) => !["users:manage", "schoolYears:reopen", "cashbox:initialize", "finance:cancel"].includes(p),
  ),
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
    "videos:write",
    "reports:read",
  ],
};

const SETS = new Map<Role, ReadonlySet<Permission>>(ROLES.map((role) => [role, new Set(MATRIX[role])]));

export function hasPermission(role: Role, permission: Permission): boolean {
  return SETS.get(role)?.has(permission) ?? false;
}

export function permissionsOf(role: Role): readonly Permission[] {
  return MATRIX[role];
}
