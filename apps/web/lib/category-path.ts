import type { CategoryNodeDTO } from "./types";

export interface ResolvedPath {
  /** Nodes from the root's child down to the node being viewed. Empty at the
   *  root itself. */
  trail: CategoryNodeDTO[];
  /** The node the page should show — the root when the path is empty. */
  node: CategoryNodeDTO;
  /** True when the requested path ran out before it was fully walked: a
   *  category was renamed away, deleted, or the link was hand-edited. The
   *  caller shows the deepest node it could reach and rewrites the URL, rather
   *  than erroring on a link that was valid yesterday. */
  truncated: boolean;
}

/** Walk `path` ("<id>/<id>") down from the root. */
export function resolvePath(root: CategoryNodeDTO, path: string | null | undefined): ResolvedPath {
  const ids = (path ?? "").split("/").filter(Boolean);
  const trail: CategoryNodeDTO[] = [];
  let node = root;
  for (const id of ids) {
    const next = node.children.find((c) => c.id === id);
    if (!next) return { trail, node, truncated: true };
    trail.push(next);
    node = next;
  }
  return { trail, node, truncated: false };
}

/** The `?path=` value for a trail — empty string means the root. */
export function pathOf(trail: CategoryNodeDTO[]): string {
  return trail.map((n) => n.id).join("/");
}
