import Link from "next/link";
import { Card, CardTitle } from "@sage/ui";
import { moneyToNumber } from "../../lib/format";
import type { PositionDTO } from "../../lib/types";
import { PositionLine } from "../rooms/position-line";

export function PortfolioCard({ positions }: { positions: PositionDTO[] }) {
  const top = [...positions]
    .sort(
      (a, b) =>
        (b.marketValue ? moneyToNumber(b.marketValue) : -Infinity) -
        (a.marketValue ? moneyToNumber(a.marketValue) : -Infinity),
    )
    .slice(0, 5);
  return (
    <Card>
      <CardTitle meta={`${positions.length} ${positions.length === 1 ? "holding" : "holdings"}`}>
        Portfolio
      </CardTitle>
      <div className="space-y-0.5">
        {top.map((p) => (
          <PositionLine key={p.symbol} position={p} />
        ))}
      </div>
      <Link
        href="/holdings"
        className="mt-3 inline-block text-xs text-muted-foreground hover:text-foreground"
      >
        View all →
      </Link>
    </Card>
  );
}
