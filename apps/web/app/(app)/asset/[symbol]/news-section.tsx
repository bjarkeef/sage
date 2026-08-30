"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, Skeleton, SectionHeader } from "@sage/ui";
import { getAssetNews } from "../../../../lib/api";
import { qk } from "../../../../lib/query/keys";
import { ArticleRow } from "../../../../components/news/article-row";

const MAX_ROWS = 8;

/** Per-asset news, loaded independently of the page. Its own query + skeleton;
 *  absent entirely when the provider has no headlines (never an empty box). */
export function NewsSection({ slug }: { slug: string }) {
  const { data, isLoading } = useQuery({
    queryKey: qk.assetNews(slug),
    queryFn: () => getAssetNews(slug),
    staleTime: 300_000,
  });

  if (isLoading) return <NewsSkeleton />;
  if (!data || data.length === 0) return null;

  return (
    <section className="mb-10">
      <SectionHeader title="News" />
      <Card>
        {data.slice(0, MAX_ROWS).map((article) => (
          <ArticleRow key={article.url} article={article} />
        ))}
      </Card>
    </section>
  );
}

function NewsSkeleton() {
  return (
    <section className="mb-10" role="status" aria-label="Loading news">
      <SectionHeader title="News" />
      <Card>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-start gap-4 border-b border-hairline-faint py-3 first:pt-0 last:border-0 last:pb-0"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-14 w-14 rounded-control" />
          </div>
        ))}
      </Card>
    </section>
  );
}
