"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardTitle } from "@sage/ui";
import { getPortfolioNews } from "../../lib/api";
import { qk } from "../../lib/query/keys";
import { ArticleRow } from "../news/article-row";

const PREVIEW = 5;

/** Portfolio-wide headlines on the overview. Loads independently of the rest of
 *  the page and stays absent until it has something to show — the portfolio feed
 *  is cache-only, so a fresh book returns nothing until per-asset views warm the
 *  cache. Rendering null (not a skeleton) while loading keeps an empty book from
 *  flashing a placeholder card that then disappears. */
export function NewsCard() {
  const { data } = useQuery({
    queryKey: qk.portfolioNews(),
    queryFn: () => getPortfolioNews(),
    staleTime: 300_000,
  });

  if (!data || data.length === 0) return null;

  return (
    <Card className="md:col-span-2">
      <CardTitle
        meta={
          <Link href="/news" className="hover:text-foreground">
            All news →
          </Link>
        }
      >
        News
      </CardTitle>
      {data.slice(0, PREVIEW).map((article) => (
        <ArticleRow key={article.url} article={article} logoSize={32} showThumbnail={false} />
      ))}
    </Card>
  );
}
