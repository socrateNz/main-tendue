import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { SCHOOL_YEAR_STATUS_LABELS, type SchoolYearStatus } from "@/features/school-years/types";

const TONES: Record<SchoolYearStatus, StatusTone> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  REOPENED: "warning",
  CLOSED: "info",
};

export function YearStatusBadge({ status, archived }: { status: SchoolYearStatus; archived?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge tone={TONES[status]}>{SCHOOL_YEAR_STATUS_LABELS[status]}</StatusBadge>
      {archived ? <StatusBadge>Archivée</StatusBadge> : null}
    </span>
  );
}
