import Image from "next/image";

import { cn } from "@/lib/utils";
import { initials } from "@/lib/text";

/** Photo d'une personne (URL signée) ou ses initiales. */
export function PersonAvatar({
  name,
  photoUrl,
  size = 36,
  className,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-semibold text-primary", className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size / 2.8) }}
    >
      {photoUrl ? <Image src={photoUrl} alt="" fill sizes={`${size}px`} className="object-cover" /> : initials(name)}
    </span>
  );
}
