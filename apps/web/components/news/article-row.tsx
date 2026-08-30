import { formatRelativeTime } from "../../lib/format";
import type { NewsArticleDTO } from "../../lib/types";
import { CompanyLogo } from "../company-logo";

function changeTone(percent: number): string {
  return percent > 0 ? "text-gain" : percent < 0 ? "text-loss" : "text-muted-foreground";
}

/** One headline row: the holding's logo, the title, and a meta line reading
 *  `TICKER ±x.xx% +N · publisher · relative time`. Shared by the asset-page
 *  News section, the overview News card, and the /news feed so the three read
 *  identically — the asset page's articles carry no `holding` (that page is
 *  already scoped to one asset), so they simply render without attribution.
 *  Meant to sit inside a Card — the first/last padding + divider rules flush
 *  the run to the card's edges. */
export function ArticleRow({
  article,
  logoSize = 40,
  showThumbnail = true,
}: {
  article: NewsArticleDTO;
  /** Size of the attribution logo. Ignored when the article has no holding. */
  logoSize?: number;
  /** Drop the provider thumbnail for the denser overview card. */
  showThumbnail?: boolean;
}) {
  const holding = article.holding;
  const change = holding?.dayChangePercent;
  const others = article.otherSymbols?.length ?? 0;

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-4 border-b border-hairline-faint py-3 first:pt-0 last:border-0 last:pb-0"
    >
      {holding && (
        <div className="shrink-0" title={holding.name}>
          <CompanyLogo website={holding.website} symbol={holding.symbol} size={logoSize} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug group-hover:underline">{article.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {holding && (
            <>
              <span>{holding.symbol}</span>{" "}
              {change != null && (
                <span className={`tabular-nums ${changeTone(change)}`}>
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </span>
              )}
              {others > 0 && <span> +{others}</span>}
              {" · "}
            </>
          )}
          {article.publisher} · {formatRelativeTime(article.publishedAt)}
        </p>
      </div>
      {showThumbnail && article.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- remote provider thumbnails, no known domains for next/image
        <img
          src={article.thumbnailUrl}
          alt=""
          loading="lazy"
          className="h-14 w-14 shrink-0 rounded-control object-cover"
        />
      )}
    </a>
  );
}
