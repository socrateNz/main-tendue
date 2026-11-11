import Image from "next/image";

import { cn } from "@/lib/utils";
import { initials } from "@/lib/text";

/** Photo de l'enfant (URL signée) ou initiales. */
export function ChildAvatar({
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

/** Âge en années révolues à la date du jour. */
export function ageOf(birthDate: string): number {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}
