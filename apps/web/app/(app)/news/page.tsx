"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, EmptyState, PageHeader, PageShell } from "@sage/ui";
import { getPortfolioNews } from "../../../lib/api";
import { qk } from "../../../lib/query/keys";
import { ArticleRow } from "../../../components/news/article-row";
import { NewsPageSkeleton } from "../../../components/skeletons";

export default function NewsPage() {
  const { data, isLoading } = useQuery({
    queryKey: qk.portfolioNews(),
    queryFn: () => getPortfolioNews(),
    staleTime: 300_000,
  });

  if (isLoading) {
    return (
      <PageShell animate={false}>
        <NewsPageSkeleton />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader title="News" description="The latest headlines across your holdings." />

      {!data || data.length === 0 ? (
        <EmptyState message="No headlines yet. Stories appear here as they come in for the companies and funds you hold." />
      ) : (
        <Card>
          {data.map((article) => (
            <ArticleRow key={article.url} article={article} />
          ))}
        </Card>
      )}
    </PageShell>
  );
}
