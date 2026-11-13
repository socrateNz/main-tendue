"use client";

import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Info, Loader2, RotateCcw, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { analyzeImportAction, runImportAction } from "@/features/imports/actions";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, type ImportAnalysis, type ImportIssue, type ImportResult } from "@/features/imports/spec";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSection } from "@/components/shared/form-section";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toCsv } from "@/lib/csv";

const CREATED_LABELS: Array<[keyof ImportResult["created"], string]> = [
  ["schools", "Établissements"],
  ["children", "Enfants"],
  ["enrollments", "Scolarités"],
  ["sponsors", "Sponsors"],
  ["sponsorships", "Parrainages"],
  ["commitments", "Engagements"],
];

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function IssueList({ title, items, tone }: { title: string; items: ImportIssue[]; tone: "danger" | "neutral" }) {
  if (!items.length) return null;
  return (
    <div className="overflow-hidden rounded-lg border">
      <p className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm font-medium">
        {tone === "danger" ? <AlertCircle className="size-4 text-destructive" aria-hidden /> : <Info className="size-4 text-muted-foreground" aria-hidden />}
        {title} ({items.length})
      </p>
      <div className="max-h-80 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Feuille</TableHead>
              <TableHead className="w-20">Ligne</TableHead>
              <TableHead>Détail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={`${item.sheet}-${item.row}-${index}`}>
                <TableCell>{item.sheet}</TableCell>
                <TableCell className="tabular-nums">{item.row}</TableCell>
                <TableCell className="whitespace-normal">
                  <ul className="flex flex-col gap-0.5">
                    {item.messages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function ImportWizard() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setAnalysis(null);
    setResult(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  async function analyze(next: File) {
    reset();
    if (!next.name.toLowerCase().endsWith(".xlsx")) return void setError("Seuls les classeurs Excel .xlsx sont acceptés.");
    if (next.size > IMPORT_MAX_BYTES) return void setError(`Fichier trop volumineux (${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} Mo maximum).`);
    setFile(next);
    setBusy(true);
    try {
      const data = new FormData();
      data.set("file", next);
      const response = await analyzeImportAction(data);
      if (!response.ok) setError(response.message);
      else setAnalysis(response.data);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!file) return { ok: false as const, message: "Aucun fichier." };
    const data = new FormData();
    data.set("file", file);
    const response = await runImportAction(data);
    if (!response.ok) return { ok: false as const, message: response.message };
    setResult(response.data);
    toast.success("Import terminé.");
    return { ok: true as const };
  }

  function downloadReport() {
    const rows: Array<[string, number, string, string]> = result
      ? result.report.map((r) => [r.sheet, r.row, r.status, r.detail])
      : analysis
        ? [
            ...analysis.issues.map((i): [string, number, string, string] => [i.sheet, i.row, "Erreur", i.messages.join(" ")]),
            ...analysis.notices.map((i): [string, number, string, string] => [i.sheet, i.row, "Ignoré", i.messages.join(" ")]),
          ]
        : [];
    download(`rapport-import-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(["Feuille", "Ligne", "Statut", "Détail"], rows));
  }

  const toCreate = analysis?.sheets.reduce((sum, s) => sum + s.create, 0) ?? 0;

  return (
    <div className="rounded-xl border bg-card p-5 shadow-card sm:p-6">
      <FormSection title="1. Préparer le fichier" description="Téléchargez le modèle, puis complétez-le. Les listes déroulantes indiquent les valeurs acceptées.">
        <div className="flex flex-col gap-3">
          <a href="/api/import/modele" className={buttonVariants({ variant: "outline", className: "w-fit" })}>
            <Download aria-hidden />
            Télécharger le modèle Excel
          </a>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            <li>Données importées : établissements, enfants (avec la scolarité de l&apos;année), sponsors et parrainages avec leur engagement.</li>
            <li>Aucun versement, don, avance ni dépense n&apos;est importé : l&apos;historique financier se saisit dans l&apos;application.</li>
            <li>
              {IMPORT_MAX_ROWS} lignes et {Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} Mo au maximum par fichier. Les lignes déjà présentes sont ignorées : un même fichier peut être
              réimporté sans créer de doublons.
            </li>
          </ul>
        </div>
      </FormSection>

      <FormSection title="2. Analyser" description="Le fichier est contrôlé ligne par ligne avec les mêmes règles que la saisie. Rien n'est enregistré à cette étape.">
        <div className="flex flex-col gap-4">
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(event) => {
              const next = event.target.files?.[0];
              if (next) void analyze(next);
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant={analysis ? "outline" : "default"} disabled={busy || confirming} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
              {busy ? "Analyse en cours…" : file ? "Choisir un autre fichier" : "Choisir le fichier .xlsx"}
            </Button>
            {file ? (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <FileSpreadsheet className="size-4" aria-hidden />
                {file.name}
              </span>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          {analysis && !result ? (
            <div className="flex flex-col gap-4">
              {analysis.fileErrors.map((message) => (
                <p key={message} role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {message}
                </p>
              ))}
              {analysis.sheets.some((s) => s.rows > 0) ? (
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Feuille</TableHead>
                        <TableHead className="text-right">Lignes</TableHead>
                        <TableHead className="text-right">À créer</TableHead>
                        <TableHead className="text-right">Déjà présentes</TableHead>
                        <TableHead className="text-right">En erreur</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.sheets.map((sheet) => (
                        <TableRow key={sheet.key}>
                          <TableCell className="font-medium">{sheet.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{sheet.rows}</TableCell>
                          <TableCell className="text-right tabular-nums">{sheet.create}</TableCell>
                          <TableCell className="text-right tabular-nums">{sheet.skip}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {sheet.errors ? <StatusBadge tone="danger">{sheet.errors}</StatusBadge> : 0}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
              {analysis.extra.enrollments || analysis.extra.commitments ? (
                <p className="text-sm text-muted-foreground">
                  Seront également créés : {analysis.extra.enrollments} scolarité(s) et {analysis.extra.commitments} engagement(s) financier(s).
                </p>
              ) : null}
              <IssueList title="Erreurs à corriger dans le fichier" items={analysis.issues} tone="danger" />
              <IssueList title="Lignes ignorées" items={analysis.notices} tone="neutral" />
              {analysis.issues.length || analysis.notices.length ? (
                <Button type="button" variant="ghost" className="w-fit" onClick={downloadReport}>
                  <Download aria-hidden />
                  Télécharger le rapport d&apos;analyse
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </FormSection>

      <FormSection title="3. Importer" description="Tout ou rien : si une seule ligne pose problème au moment de l'import, aucune donnée n'est enregistrée.">
        {result ? (
          <div className="flex flex-col gap-4">
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              Import terminé. {result.skipped} ligne(s) ignorée(s) car déjà présentes.
            </p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {CREATED_LABELS.map(([key, label]) => (
                <div key={key} className="rounded-lg border px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{result.created[key]}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={downloadReport}>
                <Download aria-hidden />
                Télécharger le rapport d&apos;import
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                <RotateCcw aria-hidden />
                Nouvel import
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button type="button" className="w-fit" disabled={!analysis?.ok || busy} onClick={() => setConfirming(true)}>
              <Upload aria-hidden />
              Importer {toCreate ? `${toCreate} ligne(s)` : ""}
            </Button>
            {analysis && !analysis.ok ? <p className="text-sm text-muted-foreground">Corrigez le fichier puis relancez l&apos;analyse pour pouvoir importer.</p> : null}
          </div>
        )}
      </FormSection>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Confirmer l'import"
        description={`${toCreate} ligne(s) vont être créées dans l'application. Les fiches créées pourront ensuite être modifiées ou archivées, mais l'import lui-même ne s'annule pas en un clic.`}
        confirmLabel="Importer"
        onConfirm={run}
      />
    </div>
  );
}
