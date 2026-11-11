export const SEXES = ["F", "M"] as const;
export type Sex = (typeof SEXES)[number];
export const SEX_LABELS: Record<Sex, string> = { F: "Fille", M: "Garçon" };

export const CHILD_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type ChildStatus = (typeof CHILD_STATUSES)[number];
export const CHILD_STATUS_LABELS: Record<ChildStatus, string> = { ACTIVE: "Actif", ARCHIVED: "Archivé" };

export const GUARDIAN_RELATIONSHIPS = ["MOTHER", "FATHER", "GUARDIAN", "GRANDPARENT", "SIBLING", "OTHER"] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];
export const GUARDIAN_RELATIONSHIP_LABELS: Record<GuardianRelationship, string> = {
  MOTHER: "Mère",
  FATHER: "Père",
  GUARDIAN: "Tuteur / tutrice",
  GRANDPARENT: "Grand-parent",
  SIBLING: "Frère / sœur",
  OTHER: "Autre",
};

export const SCHOOL_TYPES = ["PRESCHOOL", "PRIMARY", "SECONDARY", "HIGH_SCHOOL", "VOCATIONAL", "UNIVERSITY", "OTHER"] as const;
export type SchoolType = (typeof SCHOOL_TYPES)[number];
export const SCHOOL_TYPE_LABELS: Record<SchoolType, string> = {
  PRESCHOOL: "Maternelle",
  PRIMARY: "Primaire",
  SECONDARY: "Collège",
  HIGH_SCHOOL: "Lycée",
  VOCATIONAL: "Formation professionnelle",
  UNIVERSITY: "Université",
  OTHER: "Autre",
};

export const ENROLLMENT_OUTCOMES = ["PENDING", "PROMOTED", "REPEATED", "GRADUATED", "LEFT"] as const;
export type EnrollmentOutcome = (typeof ENROLLMENT_OUTCOMES)[number];
export const ENROLLMENT_OUTCOME_LABELS: Record<EnrollmentOutcome, string> = {
  PENDING: "En cours",
  PROMOTED: "Admis(e)",
  REPEATED: "Redouble",
  GRADUATED: "Diplômé(e)",
  LEFT: "A quitté l'établissement",
};
