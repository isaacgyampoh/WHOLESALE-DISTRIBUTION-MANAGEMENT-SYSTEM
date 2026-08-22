import { Badge } from "@/components/ui/badge";
import { STOCK_LABELS, type StockState } from "@/lib/catalogue/units";
import { CircleCheck, CircleAlert, CircleX } from "lucide-react";

/**
 * Stock health.
 *
 * Colour carries the urgency, an icon and words carry the meaning, so
 * the state is legible without relying on colour alone.
 */
const SHAPE: Record<StockState, { tone: "positive" | "caution" | "critical"; Icon: typeof CircleCheck }> = {
  in_stock: { tone: "positive", Icon: CircleCheck },
  low_stock: { tone: "caution", Icon: CircleAlert },
  out_of_stock: { tone: "critical", Icon: CircleX },
};

export function StockBadge({ state }: { state: StockState }) {
  const { tone, Icon } = SHAPE[state];
  return (
    <Badge tone={tone}>
      <Icon className="size-3" aria-hidden />
      {STOCK_LABELS[state]}
    </Badge>
  );
}
