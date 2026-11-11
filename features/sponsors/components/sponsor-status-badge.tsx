import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { SPONSOR_STATUS_LABELS, type SponsorStatus } from "@/features/sponsors/types";

const TONES: Record<SponsorStatus, StatusTone> = { ACTIVE: "success", INACTIVE: "warning", ARCHIVED: "neutral" };

export function SponsorStatusBadge({ status }: { status: SponsorStatus }) {
  return <StatusBadge tone={TONES[status]}>{SPONSOR_STATUS_LABELS[status]}</StatusBadge>;
}
