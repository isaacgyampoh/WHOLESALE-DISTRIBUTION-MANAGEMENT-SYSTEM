import { Card, CardHeader } from "@/components/ui/card";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ExportLink } from "./export-link";
import type { Result } from "@/lib/query/result";
import { BarChart3 } from "lucide-react";

export interface ReportColumn<T> {
  header: string;
  /** Right-aligned and tabular. Money and counts, not names. */
  numeric?: boolean;
  cell: (row: T) => React.ReactNode;
  /** Hidden below a tablet, where a wide table is unreadable anyway. */
  secondary?: boolean;
}

/**
 * One report.
 *
 * Every report on this screen is the same shape - a heading, a sentence
 * saying what the numbers mean, a table, an export - so it is declared
 * once. Writing each of the fourteen out by hand would guarantee that
 * some of them lost their empty state or their export link, which is
 * exactly what happened to the five that existed before.
 *
 * A failed report renders its own message and leaves the rest of the
 * page working. That matters here more than elsewhere: several of these
 * depend on a migration, and one unavailable report should not take the
 * other thirteen down with it.
 */
export function ReportCard<T>({
  title,
  description,
  result,
  columns,
  exportKey,
  periodDays,
  emptyTitle,
  emptyDescription,
  rowKey,
}: {
  title: string;
  description: string;
  result: Result<T[]> | null;
  columns: ReportColumn<T>[];
  exportKey: string;
  /** Passed to the export so the file matches what is on screen. */
  periodDays?: number;
  emptyTitle: string;
  emptyDescription: string;
  rowKey: (row: T, index: number) => string;
}) {
  // Null means this role does not get this report at all, so nothing is
  // rendered rather than an empty card implying there is no data.
  if (!result) return null;

  const rows = result.ok ? result.data : [];

  return (
    <Card className="overflow-hidden print-keep">
      <CardHeader
        title={title}
        description={description}
        action={
          result.ok && rows.length > 0
            ? <ExportLink report={exportKey} periodDays={periodDays} />
            : undefined
        }
      />

      {!result.ok ? (
        <ErrorState title="Report unavailable" message={result.message} />
      ) : rows.length === 0 ? (
        <EmptyState icon={BarChart3} title={emptyTitle} description={emptyDescription} />
      ) : (
        <TableWrap className="rounded-none border-0">
          <Table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <Th
                    key={c.header}
                    numeric={c.numeric}
                    className={c.secondary ? "hidden sm:table-cell" : undefined}
                  >
                    {c.header}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <Tr key={rowKey(row, i)}>
                  {columns.map((c) => (
                    <Td
                      key={c.header}
                      numeric={c.numeric}
                      className={c.secondary ? "hidden sm:table-cell" : undefined}
                    >
                      {c.cell(row)}
                    </Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}
