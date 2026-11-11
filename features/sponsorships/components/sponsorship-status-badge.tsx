import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { SPONSORSHIP_STATUS_LABELS, type SponsorshipStatus } from "@/features/sponsorships/types";

const TONES: Record<SponsorshipStatus, StatusTone> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  ENDED: "neutral",
  CANCELLED: "danger",
};

export function SponsorshipStatusBadge({ status }: { status: SponsorshipStatus }) {
  return <StatusBadge tone={TONES[status]}>{SPONSORSHIP_STATUS_LABELS[status]}</StatusBadge>;
}
