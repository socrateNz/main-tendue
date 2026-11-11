import {
  Banknote,
  CalendarRange,
  FileBarChart2,
  HandCoins,
  HandHeart,
  LayoutDashboard,
  type LucideIcon,
  Receipt,
  Settings,
  UserCog,
  Users,
  Video,
} from "lucide-react";

import type { Permission } from "@/lib/auth/permissions";

/**
 * Navigation principale.
 *
 * `available` passe à `true` lorsque le module correspondant est livré et branché sur MongoDB :
 * un module non livré est affiché comme « Bientôt » et n'est pas cliquable (aucune page vide).
 */
export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
  available: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAVIGATION: NavGroup[] = [
  {
    label: "Pilotage",
    items: [
      { title: "Tableau de bord", href: "/tableau-de-bord", icon: LayoutDashboard, permission: "dashboard:read", available: true },
      { title: "Rapports", href: "/rapports", icon: FileBarChart2, permission: "reports:read", available: false },
    ],
  },
  {
    label: "Parrainage",
    items: [
      { title: "Enfants", href: "/enfants", icon: Users, permission: "children:read", available: false },
      { title: "Sponsors", href: "/sponsors", icon: HandHeart, permission: "sponsors:read", available: false },
      { title: "Parrainages", href: "/parrainages", icon: HandCoins, permission: "sponsorships:read", available: false },
    ],
  },
  {
    label: "Finances",
    items: [
      { title: "Contributions", href: "/contributions", icon: Banknote, permission: "payments:read", available: false },
      { title: "Dépenses", href: "/depenses", icon: Receipt, permission: "expenses:read", available: false },
    ],
  },
  {
    label: "Médias",
    items: [{ title: "Vidéos", href: "/videos", icon: Video, permission: "videos:read", available: false }],
  },
  {
    label: "Administration",
    items: [
      { title: "Années scolaires", href: "/annees-scolaires", icon: CalendarRange, permission: "schoolYears:read", available: false },
      { title: "Utilisateurs", href: "/utilisateurs", icon: UserCog, permission: "users:manage", available: true },
      { title: "Paramètres", href: "/parametres", icon: Settings, permission: "settings:manage", available: false },
    ],
  },
];

/** Libellés des segments d'URL pour le fil d'Ariane. */
const SEGMENT_LABELS: Record<string, string> = Object.fromEntries(
  NAVIGATION.flatMap((group) => group.items.map((item) => [item.href.slice(1), item.title])),
);
Object.assign(SEGMENT_LABELS, { nouveau: "Nouveau", modifier: "Modifier", "mon-compte": "Mon compte", "mot-de-passe": "Mot de passe" });

export function segmentLabel(segment: string): string | null {
  return SEGMENT_LABELS[segment] ?? null;
}

export function findNavItem(pathname: string): NavItem | undefined {
  return NAVIGATION.flatMap((group) => group.items).find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}
