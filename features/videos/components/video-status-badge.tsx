import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { VIDEO_STATUS_LABELS, type VideoStatus } from "@/features/videos/types";

const TONES: Record<VideoStatus, StatusTone> = {
  PROCESSING: "info",
  AVAILABLE: "success",
  REVOKED: "warning",
  PENDING_DELETION: "danger",
  DELETED: "neutral",
};

export function VideoStatusBadge({ status }: { status: VideoStatus }) {
  return <StatusBadge tone={TONES[status]}>{VIDEO_STATUS_LABELS[status]}</StatusBadge>;
}
