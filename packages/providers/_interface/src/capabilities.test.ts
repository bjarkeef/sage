import { describe, it, expectTypeOf } from "vitest";
import type { INewsProvider, IAnalystRatingsProvider, NewsArticle, AnalystRatings } from "./index";

describe("capability interfaces", () => {
  it("INewsProvider.getNews resolves to NewsArticle[]", () => {
    expectTypeOf<INewsProvider["getNews"]>().returns.resolves.toEqualTypeOf<NewsArticle[]>();
  });
  it("IAnalystRatingsProvider.getAnalystRatings resolves to AnalystRatings | null", () => {
    expectTypeOf<
      IAnalystRatingsProvider["getAnalystRatings"]
    >().returns.resolves.toEqualTypeOf<AnalystRatings | null>();
  });
});
