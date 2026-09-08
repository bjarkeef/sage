/** A name is an "echo" when it carries no information the symbol does not
 *  already give you — the whole symbol, or the part before its exchange
 *  suffix. This is common on imported books, because the importer had
 *  nothing better and wrote the ticker in. Rendering it as a holding's
 *  second line produces `DB / DB`, which makes a carefully built list read
 *  like a database dump. */
function isEcho(symbol: string, candidate: string | null): boolean {
  if (candidate == null) return true;
  const c = candidate.trim().toLowerCase();
  if (c === "") return true;
  const s = symbol.trim().toLowerCase();
  // Split on the exchange suffix (`.MI`) and the Copenhagen-style share-class
  // hyphen (`-B`), so both `DUOMO` for `DUOMO.MI` and `NORDA` for `NORDA-B`
  // are recognised as echoes.
  const root = s.split(/[.-]/)[0] ?? s;
  return c === s || c === root;
}

/** The best real name for a holding, or the symbol when there isn't one.
 *
 *  Returns the **symbol**, never the root, in the no-name case: callers detect
 *  "no name available" with `name === symbol`, which keeps `PositionDTO.name`
 *  a plain `string` and leaves its ten consumers untouched. */
export function resolveDisplayName(
  symbol: string,
  stored: string | null,
  profile: string | null,
): string {
  if (!isEcho(symbol, stored)) return stored!.trim();
  if (!isEcho(symbol, profile)) return profile!.trim();
  return symbol;
}
