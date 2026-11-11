import { FileBarChart2 } from "lucide-react";

import type { Report, ReportColumn, ReportRow } from "@/features/reports/types";
import { EmptyState } from "@/components/shared/states";
import { formatXaf } from "@/lib/money";
import { cn } from "@/lib/utils";

function format(value: ReportRow[string] | undefined, kind: ReportColumn["kind"]): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    if (kind === "money") return formatXaf(value);
    if (kind === "percent") return `${value} %`;
    return new Intl.NumberFormat("fr-FR").format(value);
  }
  return value;
}

/** Affichage d'un rapport (même structure que l'export Excel). Adapté à l'impression. */
export function ReportView({ report }: { report: Report }) {
  return (
    <section className="report-print overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="border-b px-5 py-4">
        <h2 className="text-base font-semibold">{report.title}</h2>
        <p className="text-sm text-muted-foreground">{report.description}</p>
      </div>
      {report.rows.length === 0 ? (
        <EmptyState icon={FileBarChart2} title="Aucune donnée" description="Aucune donnée n'est enregistrée pour ce rapport et cette période." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground uppercase">
              <tr>
                {report.columns.map((column) => (
                  <th key={column.key} className={cn("px-4 py-2.5 font-medium whitespace-nowrap", column.kind === "text" ? "text-left" : "text-right")}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {report.rows.map((row, index) => (
                <tr key={index} className="hover:bg-muted/30">
                  {report.columns.map((column) => (
                    <td key={column.key} className={cn("px-4 py-2.5", column.kind === "text" ? "text-left" : "text-right tabular-nums whitespace-nowrap")}>
                      {format(row[column.key], column.kind)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {report.totals ? (
              <tfoot className="border-t-2 bg-muted/40 font-semibold">
                <tr>
                  {report.columns.map((column) => (
                    <td key={column.key} className={cn("px-4 py-3", column.kind === "text" ? "text-left" : "text-right tabular-nums whitespace-nowrap")}>
                      {format(report.totals?.[column.key], column.kind)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
      {report.notes?.length ? (
        <ul className="space-y-1 border-t px-5 py-3 text-xs text-muted-foreground">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
