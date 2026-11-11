"use client";

import { AlertCircle, CheckCircle2, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { createPaymentAction, searchPayingSponsorsAction, sponsorOpenItemsAction } from "@/features/contributions/actions";
import type { OpenCommitment } from "@/features/contributions/queries";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/features/contributions/types";
import { EntityPicker, type PickerValue } from "@/components/shared/entity-picker";
import { FormSection } from "@/components/shared/form-section";
import { Money } from "@/components/shared/money";
import { MoneyInput } from "@/components/shared/money-input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toDateInput } from "@/lib/dates";
import { CURRENCIES, CURRENCY_CODES, convertToXaf, formatXaf, normalizeRate, parseMinorAmount, type CurrencyCode } from "@/lib/money";
import { cn } from "@/lib/utils";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50";

export function PaymentForm({ initialSponsor }: { initialSponsor?: PickerValue | null }) {
  const router = useRouter();
  const [sponsor, setSponsor] = useState<PickerValue | null>(initialSponsor ?? null);
  const [open, setOpen] = useState<OpenCommitment[]>([]);
  const [advanceAvailable, setAdvanceAvailable] = useState(0);
  const [loading, startLoading] = useTransition();
  const [pending, startTransition] = useTransition();

  const [receivedAt, setReceivedAt] = useState(toDateInput(new Date()));
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("XAF");
  const [originalAmount, setOriginalAmount] = useState("");
  const [rate, setRate] = useState(currency === "XAF" ? "1" : "");
  const [allocations, setAllocations] = useState<Record<string, number | undefined>>({});
  const [donation, setDonation] = useState<number | undefined>(undefined);
  const [advance, setAdvance] = useState<number | undefined>(undefined);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!sponsor) return;
    startLoading(async () => {
      const result = await sponsorOpenItemsAction(sponsor.id);
      if (result.ok) {
        setOpen(result.data.commitments);
        setAdvanceAvailable(result.data.advanceAvailable);
      } else {
        toast.error(result.message);
      }
    });
  }, [sponsor]);

  function changeSponsor(next: PickerValue | null) {
    setSponsor(next);
    setOpen([]);
    setAllocations({});
    setAdvanceAvailable(0);
  }

  // Montant XAF calculé exactement comme sur le serveur (même fonction, arithmétique entière).
  const amountXaf = useMemo(() => {
    const minor = parseMinorAmount(originalAmount, currency);
    const normalized = currency === "XAF" ? "1" : normalizeRate(rate);
    if (!minor || !normalized) return null;
    try {
      return convertToXaf(minor, currency, normalized);
    } catch {
      return null;
    }
  }, [originalAmount, currency, rate]);

  const allocated = open.reduce((sum, c) => sum + (allocations[c.id] ?? 0), 0);
  const ventilated = allocated + (donation ?? 0) + (advance ?? 0);
  const remainder = amountXaf === null ? null : amountXaf - ventilated;
  const overLines = open.filter((c) => (allocations[c.id] ?? 0) > c.remaining);
  const movementYearStart = receivedAt;

  /** Répartit le montant restant sur les engagements, du plus ancien au plus récent. */
  function autoAllocate() {
    if (amountXaf === null) return;
    let rest = amountXaf - (donation ?? 0) - (advance ?? 0);
    const next: Record<string, number | undefined> = {};
    for (const commitment of open) {
      if (commitment.yearStartDate.slice(0, 10) > movementYearStart) continue; // engagement futur : passer par une avance
      const amount = Math.max(0, Math.min(rest, commitment.remaining));
      next[commitment.id] = amount > 0 ? amount : undefined;
      rest -= amount;
    }
    setAllocations(next);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!sponsor) local.sponsorId = "Choisissez le sponsor.";
    if (!receivedAt) local.receivedAt = "La date est obligatoire.";
    if (amountXaf === null) local.originalAmount = currency === "XAF" ? "Montant invalide." : "Montant ou taux invalide.";
    if (remainder !== null && remainder !== 0) local.lines = remainder > 0 ? `Il reste ${formatXaf(remainder)} à ventiler.` : `La ventilation dépasse le versement de ${formatXaf(-remainder)}.`;
    if (overLines.length) local.lines = "Un montant dépasse le reste dû d'un engagement : placez l'excédent en don ou en avance.";
    setErrors(local);
    if (Object.keys(local).length) return setFormError("Certains éléments sont à corriger.");

    setFormError(null);
    startTransition(async () => {
      const result = await createPaymentAction({
        sponsorId: sponsor?.id,
        receivedAt,
        method,
        reference,
        currency,
        originalAmount,
        rate: currency === "XAF" ? undefined : rate,
        lines: open.filter((c) => (allocations[c.id] ?? 0) > 0).map((c) => ({ commitmentId: c.id, amount: allocations[c.id] })),
        donationAmount: donation ?? 0,
        advanceAmount: advance ?? 0,
        note,
      });
      if (!result.ok) {
        setErrors(Object.fromEntries(Object.entries(result.fieldErrors ?? {}).map(([key, messages]) => [key, messages[0] ?? ""])));
        return void setFormError(result.message);
      }
      toast.success(result.message ?? "Versement enregistré.");
      router.push(`/contributions/${result.data.paymentId}`);
      router.refresh();
    });
  }

  const err = (key: string) => (errors[key] ? <FieldError>{errors[key]}</FieldError> : null);

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {formError ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-xl border bg-card p-5 shadow-card md:p-6">
          <FormSection title="Sponsor" description="Les sponsors actifs ou inactifs peuvent verser (règlement d'arriérés).">
            <Field className="sm:col-span-2" data-invalid={Boolean(errors.sponsorId) || undefined}>
              <FieldLabel htmlFor="pay-sponsor">Sponsor</FieldLabel>
              <EntityPicker id="pay-sponsor" value={sponsor} onChange={changeSponsor} search={searchPayingSponsorsAction} placeholder="Nom, code, e-mail…" disabled={pending} invalid={Boolean(errors.sponsorId)} />
              {err("sponsorId")}
            </Field>
          </FormSection>

          <FormSection title="Encaissement" description="La date réelle détermine automatiquement l'année scolaire du mouvement.">
            <Field data-invalid={Boolean(errors.receivedAt) || undefined}>
              <FieldLabel htmlFor="pay-date">Date du versement</FieldLabel>
              <Input id="pay-date" type="date" value={receivedAt} max={toDateInput(new Date())} onChange={(e) => setReceivedAt(e.target.value)} disabled={pending} />
              {err("receivedAt")}
            </Field>
            <Field>
              <FieldLabel htmlFor="pay-method">Moyen de paiement</FieldLabel>
              <select id="pay-method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={pending}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </Field>
            <Field className="sm:col-span-2" data-invalid={Boolean(errors.reference) || undefined}>
              <FieldLabel htmlFor="pay-ref">Référence (facultatif)</FieldLabel>
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° de virement, de reçu, de transaction…" disabled={pending} />
              <FieldDescription>Une même référence ne peut pas être enregistrée deux fois pour un même moyen de paiement.</FieldDescription>
              {err("reference")}
            </Field>
          </FormSection>

          <FormSection title="Montant" description="Pour une devise étrangère, saisissez le montant reçu et le taux appliqué : le montant comptable est converti en FCFA.">
            <Field>
              <FieldLabel htmlFor="pay-currency">Devise</FieldLabel>
              <select
                id="pay-currency"
                className={selectClass}
                value={currency}
                onChange={(e) => {
                  const next = e.target.value as CurrencyCode;
                  setCurrency(next);
                  setRate(next === "XAF" ? "1" : next === "EUR" ? "655,957" : "");
                }}
                disabled={pending}
              >
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {CURRENCIES[code].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field data-invalid={Boolean(errors.originalAmount) || undefined}>
              <FieldLabel htmlFor="pay-amount">Montant reçu ({CURRENCIES[currency].symbol})</FieldLabel>
              <Input id="pay-amount" inputMode="decimal" value={originalAmount} onChange={(e) => setOriginalAmount(e.target.value)} placeholder={currency === "XAF" ? "100000" : "150,00"} className="text-right tabular-nums" disabled={pending} />
              {err("originalAmount")}
            </Field>
            {currency !== "XAF" ? (
              <Field data-invalid={Boolean(errors.rate) || undefined}>
                <FieldLabel htmlFor="pay-rate">Taux : 1 {currency} = … FCFA</FieldLabel>
                <Input id="pay-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="text-right tabular-nums" disabled={pending} />
                <FieldDescription>{currency === "EUR" ? "Parité fixe EUR/XAF : 655,957." : "Taux du jour appliqué par la banque."}</FieldDescription>
                {err("rate")}
              </Field>
            ) : null}
            <div className="flex flex-col justify-end rounded-lg bg-muted/40 px-3 py-2">
              <span className="text-xs text-muted-foreground">Montant comptable</span>
              <span className="text-lg font-semibold tabular-nums">{amountXaf === null ? "—" : formatXaf(amountXaf)}</span>
            </div>
          </FormSection>

          <section className="space-y-3 py-6 last:pb-0">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Ventilation</h2>
                <p className="text-sm text-muted-foreground">Affectez le versement aux engagements dus. L&apos;excédent n&apos;est jamais affecté automatiquement : placez-le en don libre ou en avance.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={autoAllocate} disabled={!sponsor || amountXaf === null || open.length === 0 || pending}>
                <Sparkles aria-hidden />
                Répartir sur les engagements
              </Button>
            </div>

            {!sponsor ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Choisissez d&apos;abord le sponsor.</p>
            ) : loading ? (
              <p className="flex items-center justify-center gap-2 rounded-lg border px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Chargement des engagements…
              </p>
            ) : open.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Aucun engagement en attente pour ce sponsor : le versement peut être enregistré en don libre ou en avance.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {open.map((commitment) => {
                  const future = commitment.yearStartDate.slice(0, 10) > movementYearStart;
                  const value = allocations[commitment.id];
                  const over = (value ?? 0) > commitment.remaining;
                  return (
                    <li key={commitment.id} className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {commitment.childName} <span className="font-normal text-muted-foreground">· {commitment.yearLabel}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Reste dû <Money amount={commitment.remaining} className="font-medium text-foreground" /> sur <Money amount={commitment.expected} />
                          {commitment.yearClosed ? " · année clôturée (règlement tardif)" : ""}
                          {future ? " · année future : passez par une avance" : ""}
                        </p>
                      </div>
                      <MoneyInput
                        aria-label={`Montant affecté à ${commitment.childName} (${commitment.yearLabel})`}
                        value={value}
                        onChange={(next) => setAllocations((current) => ({ ...current, [commitment.id]: next }))}
                        disabled={pending || future}
                        aria-invalid={over || undefined}
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="pay-donation">Don libre</FieldLabel>
                <MoneyInput id="pay-donation" value={donation} onChange={setDonation} disabled={pending || !sponsor} />
                <FieldDescription>Recette distincte des contributions aux engagements.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="pay-advance">Avance (crédit du sponsor)</FieldLabel>
                <MoneyInput id="pay-advance" value={advance} onChange={setAdvance} disabled={pending || !sponsor} />
                <FieldDescription>Encaissée maintenant, affectée plus tard après validation. Crédit actuel : {formatXaf(advanceAvailable)}.</FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="pay-note">Observation (facultatif)</FieldLabel>
              <Textarea id="pay-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={pending} />
            </Field>
          </section>
        </div>

        {/* Récapitulatif collant */}
        <aside className="h-fit space-y-4 rounded-xl border bg-card p-5 shadow-card xl:sticky xl:top-20">
          <h2 className="text-sm font-semibold">Récapitulatif</h2>
          <dl className="space-y-2 text-sm">
            {[
              ["Montant du versement", amountXaf ?? 0],
              ["Affecté aux engagements", allocated],
              ["Don libre", donation ?? 0],
              ["Avance", advance ?? 0],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>
                  <Money amount={value as number} />
                </dd>
              </div>
            ))}
          </dl>
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm",
              remainder === 0 && amountXaf !== null && !overLines.length ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
            )}
            role="status"
          >
            {remainder === 0 && amountXaf !== null && !overLines.length ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <span>
              {amountXaf === null
                ? "Saisissez le montant du versement."
                : overLines.length
                  ? "Un montant dépasse le reste dû d'un engagement."
                  : remainder === 0
                    ? "Ventilation complète."
                    : remainder !== null && remainder > 0
                      ? `Reste à ventiler : ${formatXaf(remainder)}.`
                      : `Ventilation excédentaire de ${formatXaf(-(remainder ?? 0))}.`}
            </span>
          </div>
          {err("lines")}
          <div className="flex flex-col gap-2">
            <Button type="submit" disabled={pending || remainder !== 0 || amountXaf === null || overLines.length > 0}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Enregistrer le versement
            </Button>
            <Link href="/contributions" className={buttonVariants({ variant: "outline" })}>
              Annuler
            </Link>
          </div>
        </aside>
      </div>
    </form>
  );
}
