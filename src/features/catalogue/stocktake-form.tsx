"use client";

import { useActionState } from "react";
import { recordStocktakeAction, INITIAL_INVENTORY_STATE } from "./actions";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Field, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { TableWrap, Table, Th, Td, Tr } from "@/components/ui/table";
import { formatQuantity } from "@/lib/utils/format";

interface CountLine {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  qtyOnHand: number;
}

/**
 * Stock count: what is physically on the shelf, right now.
 *
 * A blank box means "not counted" and writes nothing. Only lines that
 * differ from the ledger produce a movement, so a count where everything
 * agrees leaves the history clean rather than filling it with zeros.
 */
export function StocktakeForm({
  warehouseId,
  warehouseName,
  lines,
}: {
  warehouseId: string;
  warehouseName: string;
  lines: CountLine[];
}) {
  const [state, submit, pending] = useActionState(
    recordStocktakeAction,
    INITIAL_INVENTORY_STATE,
  );

  return (
    <form action={submit} className="space-y-5">
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <input type="hidden" name="warehouseLabel" value={warehouseName} />

      {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
      {state.status === "done" && <Alert tone="success">{state.message}</Alert>}

      <Card>
        <CardHeader
          title={`Counting ${warehouseName}`}
          description="Fill in only what you have actually counted. Anything left blank is untouched."
        />
        <TableWrap className="rounded-t-none border-0">
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th numeric>System says</Th>
                <Th numeric>Counted</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <Tr key={line.productId}>
                  <Td>
                    <span className="block font-medium">{line.name}</span>
                    <span className="text-xs text-[var(--text-muted)]">{line.sku}</span>
                  </Td>
                  <Td numeric>
                    {formatQuantity(line.qtyOnHand)}
                    <span className="ml-1 text-xs text-[var(--text-muted)]">{line.unit}</span>
                  </Td>
                  <Td numeric className="w-32">
                    <Input
                      name={`count.${line.productId}`}
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      placeholder="-"
                      aria-label={`Counted quantity of ${line.name}`}
                      className="h-9 text-right"
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <Field label="Note" htmlFor="notes" hint="Kept against every correction this count produces.">
        <Textarea id="notes" name="notes" maxLength={200} rows={2} placeholder="Monthly count" />
      </Field>

      <Alert tone="info">
        Differences are posted as stock count movements, so the figure before the
        count is still in the product&apos;s history.
      </Alert>

      <Button type="submit" size="lg" loading={pending}>
        Post the count
      </Button>
    </form>
  );
}
