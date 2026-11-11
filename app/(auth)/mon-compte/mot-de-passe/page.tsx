import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ShieldAlert } from "lucide-react";

import { ChangePasswordForm } from "@/features/auth/components/change-password-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Changer le mot de passe" };

export default function ChangePasswordPage() {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-panel sm:p-7">
      <Suspense fallback={<div className="h-80" aria-busy="true" />}>
        <ChangePasswordContent />
      </Suspense>
    </div>
  );
}

async function ChangePasswordContent() {
  const user = await requireUser({ allowPendingPasswordChange: true });
  const mandatory = user.mustChangePassword;

  return (
    <>
      <div className="mb-6 space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{mandatory ? "Choisissez votre mot de passe" : "Changer le mot de passe"}</h1>
        <p className="text-sm text-muted-foreground">
          Bonjour {user.firstName}.{" "}
          {mandatory
            ? "Votre compte utilise un mot de passe temporaire : remplacez-le pour continuer."
            : "Vos autres sessions seront fermées après le changement."}
        </p>
      </div>
      {mandatory ? (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2.5 text-sm text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Ne communiquez jamais votre mot de passe, y compris aux administrateurs.</span>
        </div>
      ) : null}
      <ChangePasswordForm mandatory={mandatory} redirectTo={mandatory ? "/tableau-de-bord" : "/mon-compte"} />
      {!mandatory ? (
        <Link href="/mon-compte" className="mt-4 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← Retour à mon compte
        </Link>
      ) : null}
    </>
  );
}
