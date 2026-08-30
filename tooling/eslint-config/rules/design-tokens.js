/**
 * Bans off-token Tailwind classes in class contexts (JSX className,
 * cn()/clsx()/cva() arguments): arbitrary font sizes, off-token radii,
 * raw palette colors, and hex colors. See packages/ui/DESIGN.md.
 */
const BANNED = [
  {
    re: /\btext-\[[0-9.]+(?:px|em|rem)\]/,
    msg: "Arbitrary font size — use a type-role token (text-data, text-title, hero-num, stat-num, label-caps).",
  },
  {
    re: /\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/,
    msg: "Off-token radius — use rounded-card, rounded-control, rounded-badge, or rounded-full.",
  },
  {
    re: /\brounded-\[[^\]]+\]/,
    msg: "Arbitrary radius — use rounded-card, rounded-control, rounded-badge, or rounded-full.",
  },
  {
    re: /(?:^|[\s"'`:])(?:text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|shadow|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}(?:\/\d+)?\b/,
    msg: "Raw Tailwind palette color — use semantic tokens (gain, loss, income, muted-foreground, …).",
  },
  {
    re: /#[0-9a-fA-F]{3,8}\b/,
    msg: "Hex color in a class string — use semantic tokens.",
  },
];

const CLASS_FN_NAMES = new Set(["cn", "clsx", "cva"]);

function isClassContext(node) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (
      cur.type === "JSXAttribute" &&
      (cur.name?.name === "className" || cur.name?.name === "class")
    ) {
      return true;
    }
    if (
      cur.type === "CallExpression" &&
      cur.callee.type === "Identifier" &&
      CLASS_FN_NAMES.has(cur.callee.name)
    ) {
      return true;
    }
  }
  return false;
}

function check(context, node, text) {
  if (typeof text !== "string" || !isClassContext(node)) return;
  for (const { re, msg } of BANNED) {
    if (re.test(text)) {
      context.report({ node, message: msg });
    }
  }
}

export default {
  meta: {
    type: "problem",
    docs: { description: "enforce Sage design tokens in class strings" },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        check(context, node, node.value);
      },
      TemplateElement(node) {
        check(context, node, node.value.raw);
      },
    };
  },
};
