# @sage/ui design system

Sage's authenticated app is a Fey look — calm, flat, near-black, hairlines and
washes instead of boxes and shadows — carrying a Snowball information
architecture: readable rows with column headers, two-line cells, and a
`+abs (+%)` delta grammar instead of dashboards' tiny glyph clutter. Dark is
the default theme. Every page composes from the primitives below; nothing
inlines a card shell, an arbitrary font size, or an off-token radius.

Source of truth for every value here: `docs/superpowers/specs/2026-07-16-design-system-sage-fey.md`.
Live values: `packages/ui/src/styles/tokens.css` + `globals.css`.

## 1. Tokens

### Container & rhythm

| Token / primitive | Value                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Page container    | `max-w-page` **1120px**, centered, `px-4 sm:px-8` (16px below `sm`, 32px above — 32 each side is 17% of a 375px phone) |
| Narrow container  | `max-w-narrow` **720px** — `<PageShell width="narrow">` (Settings; Import stays default-width for its preview tables)  |
| Section spacing   | **56px** vertical between page sections; whitespace is the separator, never a background shift                         |
| Card padding      | **24px** (`p-6`); `<Card compact>` → **20px** (`p-5`); intra-card gaps **12–14px**                                     |
| Row height        | **44px** (`min-h-11`) single-line rows; two-line cells (primary + secondary) grow the same row, no separate track      |

### Breakpoints

Two boundaries, and only two. Anything else is a one-off that will drift.

| Boundary       | What changes                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `sm` **640px** | Paired form fields stack (`FieldRow`); dialogs stop centering and anchor to the bottom edge as sheets                |
| `md` **768px** | The shell: below it the sidebar leaves the flow entirely and `MobileNav`'s bottom bar takes over; above, the reverse |

**The shell is the whole responsive story.** The sidebar is a fixed 220px — on
a 375px phone that left a 155px content column, and every page looked broken for
that one reason. Fix the shell and the pages follow: of 137 component files,
only a handful ever needed a breakpoint of their own.

So before adding a `sm:`/`md:` variant to a page, check whether it is really
the shell you are working around.

**Rules that hold everywhere:**

- **The page never scrolls sideways — and you must measure `<main>` to know.**
  `body` is `overflow: hidden`, so `document.documentElement.scrollWidth` can
  never exceed the viewport and a check written against it passes no matter how
  badly the page overflows. The real scroller is `<main>`; the condition is
  `main.scrollWidth > main.clientWidth`. This is not hypothetical: the mobile
  shell shipped against the document check, and a phone found the side-scroll
  the same day.
- Content that is genuinely wider than a phone — a seven-column month, a
  multi-column table — goes in its own `overflow-x-auto` with a `min-w-[…]`
  floor, so it scrolls inside its card rather than dragging `main` with it.
  `grid-cols-N` will _not_ save you: its tracks are `minmax(0,1fr)`, so cells
  silently compress to illegibility instead of overflowing where a check would
  catch them.
- **A grid or flex child holding that scroller needs `min-w-0`.** Its default
  `min-width: auto` refuses to shrink below its content's min-content width, so
  the `overflow-x-auto` never engages and the card pushes `main` sideways
  instead. `/categories` shipped its table inside a
  `grid lg:grid-cols-[240px_1fr]` and overflowed to 552px on a 375px phone until
  both cells got `min-w-0` — the table's own `overflow-x-auto` was there the
  whole time and could do nothing.
- **Action rows wrap — including the button group inside them.** A header with a
  title and two buttons exceeds 375px, and two buttons alone are 345px against a
  311px content column. `flex-wrap` on the outer row is not enough if the group
  holding the buttons cannot wrap; both need it.
- **Heights near the viewport use `dvh`, never `vh`.** `vh` ignores mobile
  browser chrome, so a footer measured in it sits underneath the address bar.
- **Anything fixed to the bottom pads by `env(safe-area-inset-bottom)`**, and
  the scroll container above it pads to match. This requires
  `viewportFit: "cover"` in the root layout's viewport export — without it iOS
  reports the inset as zero.

### Depth — wash, not borders

| Token              | Value          | Use                                              |
| ------------------ | -------------- | ------------------------------------------------ |
| `--surface-card`   | alpha **.035** | card / callout / empty-state fill — and its edge |
| `--surface-hover`  | alpha **.04**  | row/nav hover                                    |
| `--surface-active` | alpha **.07**  | **input fill**, active nav, active chips         |
| `--surface-focus`  | alpha **.09**  | focus state                                      |
| `--hairline`       | alpha **.07**  | section rules, floating-overlay edges            |
| `--hairline-faint` | alpha **.05**  | dividers inside cards (e.g. `StatStrip`)         |

Alphas are white-on-dark (`.dark`) / near-black-on-light (`:root`) — same
ladder, themed values. **No shadows on dark surfaces.**

#### A surface in the page flow has no border. Only floating things do.

This is the rule the codebase got backwards for months, so it is stated as a
line you can check rather than a principle you can interpret:

- **In the flow → wash, no border.** `Card`, `Callout`, `ErrorState`, `Input`,
  and anything you build that behaves like them. The fill _is_ the edge.
- **Floating over arbitrary content → border allowed.** `Popover`, `Dialog`,
  `Toast`. These land on top of whatever happens to be beneath them, so they
  need an edge that does not depend on contrast with it.
- **Inside a card → neither.** Internal structure is whitespace and
  `--hairline-faint`, never a box.
- **One narrow exception: a border that denotes a _state_, not a surface.** A
  dashed outline marking an empty slot or a file drop target (`/import`,
  `/goal`'s empty projection) says "nothing here yet, put something here"; the
  destructive outline on Settings' danger zone says "this one bites". These are
  signals, and they stay. The test is whether removing the border would lose
  information: on a `Card` it loses nothing, on a drop zone it loses the
  affordance.

**Why it is written this way.** `--surface-card` was `.015` while `--hairline`
was `.07`: the outline was **4.7× stronger than the fill it enclosed**, so every
card read as an empty box ruled onto the ground — the exact inverse of "depth
from washes, not borders", shipped under that heading. `Input` had the same
inversion (`bg-background` inside `border-input`, while `--surface-active` sat
there documented as the input fill and unused), and the asset page's position
grid faked a full table ruling with `gap-px` over `bg-hairline-faint`.

`Card` and `Callout` have tests asserting the **absence** of a border. If you
find yourself re-adding one because two surfaces are hard to tell apart, the
answer is a bigger gap, not a line.

### Radii

| Token                                  | Value    | Use                                                    |
| -------------------------------------- | -------- | ------------------------------------------------------ |
| `--radius-card` (`rounded-card`)       | **16px** | cards, rows, tiles                                     |
| `--radius-control` (`rounded-control`) | **8px**  | buttons, inputs, nav items, row hover                  |
| `--radius-badge` (`rounded-badge`)     | **6px**  | chips, tiny badges                                     |
| `rounded-full`                         | —        | pills, dots, avatars — the only other radius permitted |

No `rounded-sm/md/lg/xl/2xl/3xl` or arbitrary `rounded-[…]` anywhere.

### Type roles

Geist + Geist Mono. Mono is demoted to data only — the core fix over the old
"everything is mono caps" look.

| Role                   | Class / utility                                                                        | Spec                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero numeral           | `hero-num`                                                                             | Geist 300, 44px, `-0.02em`, tabular-nums                                                                                                                                                            |
| Stat numeral           | `stat-num`                                                                             | Geist 300, 32px, `-0.02em`, tabular-nums                                                                                                                                                            |
| Small stat numeral     | `<Stat size="sm">` (`font-display text-xl font-light tracking-[-0.01em] tabular-nums`) | Geist 300, 20px — for dense strips beneath a hero/md stat                                                                                                                                           |
| Page title             | `<PageHeader>` h1 (`font-display text-title font-semibold tracking-[-0.03em]`)         | Geist 600, 28px, `-0.03em`                                                                                                                                                                          |
| Section header         | `<SectionHeader>` h2 (`text-sm font-semibold`)                                         | sans 14px/600 — replaces shouting `label-caps` h2s                                                                                                                                                  |
| Card title             | `<CardTitle>` h3 (`text-sm font-medium`)                                               | sans 14px/500                                                                                                                                                                                       |
| Caps eyebrow           | `label-caps`                                                                           | 11px mono, uppercase, `.12em`, `--muted-foreground`. Shared by `Stat` labels, `Chip` text, and `RowHeader` column headers — there is one caps utility in this codebase, not a separate size per use |
| Data figure            | `text-data` (13px, tabular, mono via `font-mono text-data tabular-nums`)               | reserved for figures in rows/cells — nothing else                                                                                                                                                   |
| Secondary/context line | `text-xs text-muted-foreground` (12px)                                                 | `Stat` context, `CardTitle` meta, `RowCell` secondary                                                                                                                                               |
| Body                   | sans, `text-muted-foreground` / `text-foreground`                                      | prose — figures inside sentences are sans + `tabular-nums`, never mono                                                                                                                              |

Dates are always human (`May 11, 2026`) via the shared `formatDate` helper —
ISO strings never render in the UI.

### Color

- Ground, sage ramp, brand indirection (`--brand-100…800` → `--sage-*`):
  unchanged: swap the 8 aliases to rebrand.
- `--gain` → `#3dbe86` (dark) / green-500 (light); `--loss` → `#e87468`
  (dark, coral, softer than red) / red-500 (light).
- Muted body copy: cool blue-gray family (`--muted-foreground`).
- `--seg-1…7` + `--seg-rest` is the **only** categorical ramp — desaturated,
  data only, never chrome. `AllocationBars` uses it for every segmented bar
  (allocation/diversification, income composition); there is no separate
  allocation or category palette.
- **Gold is income, and it has two tokens because one cannot do both jobs on a
  light ground.** `--income` is the TEXT value and must clear 4.5:1 against the
  card, which on white pushes gold down to a brown. `--income-fill` is for
  AREAS — progress bars, dots, legend swatches — which only need 3:1 and can
  therefore sit where gold still looks like gold. Use `text-income` for
  figures and `bg-income-fill` for anything with area. In dark they resolve to
  the same value; reach for the right one anyway, or light theme silently
  regresses. The same constraint shapes the `--certainty-*` bar ramp, which is
  inverted between themes (darkest = most certain on light, lightest on dark)
  and documented at length in `tokens.css`.
- **The shell has its own ground, `--sidebar`.** In dark it equals
  `--background` — Fey's one-flat-ground rule. In light it steps down a shade,
  because two near-whites separated by a hairline do not read as two regions.
- **Light sits on warm paper; dark sits on neutral near-black.** The two themes
  use different ground families on purpose. `--paper-50/100/200` + `--ink-900`
  are the light ground and are gently warm; the `--gray-*` ramp is and must
  stay true neutral (R≈G≈B), because it carries dark and was made neutral to
  fix a green cast there. **The alpha ladder is warm in light too** — every
  `--surface-*` and `--hairline*` composites `48 38 22`, not the old neutral
  `20 20 19`. A cool-grey alpha over a warm ground reads as a faint film, and
  that mismatch is most of what made the old light theme look washed out. If
  you add a light-theme surface, take its alpha from the same warm base.

#### Accent discipline — the accent has an allowlist, not a banlist

"Sage never colors chrome" was in this file twice and was still being broken in
a dozen places, because nobody agreed on what counted as chrome. So the rule is
inverted: **`--primary` / `--accent` may appear in these places and nowhere
else.**

| Allowed               | Example                                           |
| --------------------- | ------------------------------------------------- |
| The chart line        | `--chart-line` is `--primary` by definition       |
| Data marks on a chart | the invested overlay, a weight bar, an `avg` rule |
| The focus ring        | `--ring`                                          |
| Text links in prose   | `text-primary hover:underline`                    |
| The brand mark        | `SageMark`                                        |

Everything else is chrome and takes `--foreground`, `--muted-foreground`, or a
`--surface-*` wash. **Emphasis is carried by weight, not by hue:** `Chip`'s
`primary` tone is a brighter wash plus full-strength text against `neutral`'s
muted pair; `Switch`'s "on" is `bg-foreground`, matching `Button`'s default
variant so both read as the same kind of affordance.

This is not an aesthetic preference. The accent is the only colour in the app
with no other job, so every place it appears that _isn't_ carrying meaning
spends the one signal it has. Nine sage switches down the Settings page and a
sage nav pill are why the dark theme kept getting reported as "green" and
"terminal" — a complaint twice misdiagnosed as a tinted grey ramp.

Specifically banned, all of which shipped and have since been removed: the
active sidebar and bottom-bar nav item, `Switch`'s checked track, the account
avatar, status chips (`In portfolio`, `Corrected`), the dividend calendar's
today marker, and the goal page's Insight callout.

`Chip` and `Switch` have tests asserting they do not reach for it.

### Delta grammar

▲▼ triangles are retired everywhere. A delta renders as signed text
`+$412.50 (+3.42%)` — absolute + percent, always together, always in that
order — via `<Delta>`, or as a small filled pill via `<Delta variant="chip">`.
Color lives on the delta text/chip only, never on surrounding chrome.

### Motion

**Chrome enters once, one way.** One `fade-up` cascade (0.3–0.5s),
`prefers-reduced-motion` respected. (Baked into `PageShell` with
`animate={false}` for skeletal pages; a standalone `fade-up` utility remains for
pages outside `PageShell`.) No decorative entrance anywhere — no staggered
letters, no scale-ins, no scroll-triggered reveals.

**One exception, and it is narrow: a data-bearing entrance, where the motion IS
the data.** A series drawing along its own axis; a figure travelling its own
range. Permitted only when every one of these holds:

- The movement traces a real quantity. A line drawing left to right is time
  passing. A hero numeral counting _from the range's opening value to today's_
  travels the distance the chart travels — the same fact, told twice, at one
  speed. A numeral spinning up from zero traces nothing and is decoration.
- **900ms ceiling**, once per mount. Never on a re-render, a refetch, or a range
  change: an entrance that replays every time data arrives is a stutter, not a
  welcome.
- The resting state is the truth. If the animation never ran — reduced motion,
  a dropped frame, a screenshot — the reader sees the finished chart, not an
  empty one.
- Off wholesale under `prefers-reduced-motion`, not slowed down.

This exists because the overview hero is the one screen where the chart _is_ the
product rather than an illustration of it, and a chart that assembles itself in
front of you says "these are your numbers, arriving" in a way a static PNG
cannot. Everywhere else, the cascade is enough. If you are reaching for this
clause to make a card livelier, the answer is no.

**Interaction motion is separate from entrance motion and has its own budget.**
Hover and state transitions: 120–200ms, ease-out. A crosshair or pointer-follower
eases toward its target (~120ms) rather than welding to the cursor — weight
reads as precision, and a line rigidly attached to the pointer reads as a
tooltip. **Figures under a moving pointer change instantly**: tweening several
numerals while the hand is moving turns a readout into a slot machine. Colour is
the exception — a value crossing zero cross-fades `--gain`/`--loss` over ~200ms
so the sign change registers rather than flickering.

Its one counterpart is `fade-out-down` (0.2s), for something that leaves under
its own steam rather than because the user navigated — a toast expiring.
Exits are quicker than entrances: an exit that lingers reads as lag. Anything
using it must stay mounted for the duration, or it blinks out instead of
fading.

### Affordance — a hover state is a promise

Anything that changes under the pointer is telling the reader it will do
something. If it will not, the change is a lie, and the reader learns to
distrust every other hover in the app.

- **A hover background belongs to something that responds** — a link, a button,
  a row that opens. `--surface-hover` is the row/nav hover; it is not decoration
  for a static card.
- **Never reveal a chevron, arrow or ↗ on something with no destination.** Nine
  analytics cards carried a fade-in ↗ and a hover wash with no `href` and no
  `onClick` between them, from a mockup where the destinations were "coming in a
  later task" and never arrived. Removed 2026-09-10.
- **The cursor states the truth.** Interactive elements are `<a>` or `<button>`,
  which get the right cursor for free. A `cursor-pointer` on a `<div>` usually
  means the element should have been a button — and would then also be
  focusable and reachable by keyboard, which a styled `<div>` is not.
- **What is hoverable is focusable.** Any state reachable with a pointer has a
  visible `:focus-visible` equivalent, or the affordance simply does not exist
  for keyboard users. Row actions that fade in on hover pair
  `group-hover:opacity-100` with `focus-within:opacity-100`, and
  `[@media(hover:none)]:opacity-100` so a touch device is not left with a
  control it can never reveal — see `holding-row.tsx`.

The inverse is a bug too: a control with no hover state at all reads as
decoration. Every interactive element gets one, on the 120–200ms budget above.

## 2. The contracts

Each one-line rule, with the real component APIs.

**Readable row** — multi-column lists get column headers, two-line cells,
≤4 data columns, and `Delta`'s `+abs (+%)` grammar; further facts move to a
popover or the asset page.

```tsx
// Do
<RowGrid columns="1.6fr 1fr 1fr 0.8fr">
  <RowHeader cells={["Holding", "Value", "Return", "Weight"]} />
  <DataRow>
    <RowCell variant="text" primary="AAPL" secondary="Apple Inc." />
    <RowCell align="right" primary="$12,480.00" secondary="120 sh" />
    <RowCell align="right" primary={<Delta value={412.5} percent={3.42} />} />
    <RowCell align="right" primary="8.1%" />
  </DataRow>
</RowGrid>

// Don't
<div className="grid grid-cols-4 border border-hairline p-2">
  <span>AAPL</span>
  <span>$12,480.00</span>
  <span className="text-green-500">▲ 3.42%</span>
  <span>8.1%</span>
</div>
```

**Mono is for data figures, caps eyebrows, chips — nothing else.**

```tsx
// Do
<p className="text-sm text-muted-foreground">
  You earned <span className="tabular-nums">$115.17</span> more than last month.
</p>

// Don't
<p className="font-mono text-sm text-muted-foreground">
  You earned $115.17 more than last month.
</p>
```

**One caps level per region** — a card/section shows at most one `label-caps`
element (its `Stat` label or eyebrow); titles stay sans.

```tsx
// Do
<Card>
  <CardTitle meta="12 positions">Top holdings</CardTitle>
  <Stat label="Total value" value="$142,880" />
</Card>

// Don't
<Card>
  <h3 className="label-caps">TOP HOLDINGS</h3>
  <div className="label-caps">$142,880</div>
</Card>
```

**`label-caps` is an eyebrow over a figure — never a form label.** Form labels
are sans `text-xs font-medium`, via `Field`. A dialog of six caps-mono labels
shouts, and it breaks the one-caps-per-region rule above: a form's single caps
element is the summary figure's label, if it has one.

```tsx
// Do
<Field label="Price / share" htmlFor="price"><Input id="price" /></Field>

// Don't
<label className="label-caps">PRICE / SHARE</label>
<Input placeholder="Price / share" />
```

**`·` separates data fields, never a label from its qualifier.** `AAPL · Jul 24`
is two facts of equal standing. `Annual income · forward · after tax` is a label
wearing a sentence — basis, timeframe, and tax qualifiers belong in the card's
`InfoTooltip` or a page-level basis note, not appended to a caps eyebrow. A caps
eyebrow names the figure and nothing else.

```tsx
// Do
<div className="label-caps">Annual income</div>
<span className="text-xs text-muted-foreground">AAPL · Jul 24</span>

// Don't
<div className="label-caps">Annual income · forward · after tax</div>
```

**No borders on a surface in the page flow, none inside a card, no shadows on
dark surfaces** — the wash is the edge, internal structure is whitespace +
`--hairline-faint`, and only floating overlays (`Popover`, `Dialog`, `Toast`)
get a line. See §1 "A surface in the page flow has no border".

```tsx
// Do
<Card>
  <CardTitle>Position</CardTitle>
  <StatStrip>
    <Stat label="Shares" value="120" />
    <Stat label="Avg cost" value="$88.40" />
  </StatStrip>
</Card>

// Don't
<Card>
  <div className="divide-y divide-border rounded-lg border shadow-md">…</div>
</Card>
```

**Accent never colors chrome** — see the allowlist in §1. Sage is the chart
line, data marks, the focus ring, prose links and the brand mark. Nav states,
switches, status chips and "today" markers are chrome: they take a wash and a
foreground, and emphasis comes from weight.

```tsx
// Do
<Button>Add transaction</Button>
<Chip tone="primary">In portfolio</Chip>          {/* brighter wash, foreground text */}
<Link className={active ? "bg-surface-active text-foreground" : "text-muted-foreground"} />

// Don't
<Button className="bg-primary text-primary-foreground">Add transaction</Button>
<span className="bg-primary/10 text-primary">In portfolio</span>
<Link className={active ? "bg-accent text-primary" : "text-muted-foreground"} />
```

**Human dates always** — never ISO in the UI.

```tsx
// Do
<span>{formatDate(exDate)}</span> {/* "May 11, 2026" */}

// Don't
<span>{exDate.toISOString().slice(0, 10)}</span> {/* "2026-05-11" */}
```

**Deltas: `+abs (+%)`, glyphs banned.**

```tsx
// Do
<Delta value={412.5} percent={3.42} currency="USD" /> {/* "+$412.50 (+3.42%)" */}

// Don't
<span className="text-green-500">▲ 3.42%</span>
```

**Empty sections render nothing, never an empty box** — if a section has
nothing to say, don't mount its shell; if a list inside a mounted section is
empty, use `EmptyState`'s one sentence, not a bare bordered div.

```tsx
// Do
{
  rows.length > 0 && (
    <Card>
      <CardTitle>Recent activity</CardTitle>
      {/* rows */}
    </Card>
  );
}

// Don't
<Card>
  <CardTitle>Recent activity</CardTitle>
  <div className="rounded-card border p-6 text-center text-muted-foreground">No data</div>
</Card>;
```

**A write is confirmed, a failure is explained where it can be fixed** — every
mutation (add, edit, delete) raises a `useToast()` confirmation naming what
changed, not just that something did: a dialog that shuts silently is
indistinguishable from one that dropped the entry. Failures go the other way —
they stay inline (`Callout`, or a form's own error) next to the fields that
have to change, because a toast pulls the explanation away from the fix and
expires while the user is still reading it. Never report the same outcome in
both places.

**Confirmations are neutral — green is a figure colour, not a status colour.**
`--gain` belongs to `Delta` and to money going up. Spending it on "the write
worked" dilutes the one signal it carries, and on a deletion it actively
misreads: green says losing the row was good news. `Toast` therefore has no
success tone at all, only neutral and `error`; the words carry the outcome.

```tsx
// Do
await createTransaction(input);
toast({ title: "Transaction added", description: "Bought 10 AAPL" });
// ...and on failure
setFormError(err.message);

// Don't — "Saved!" with nothing to say what, and an error that vanishes
toast({ title: "Saved!" });
toast({ title: err.message, tone: "error" });
```

## 3. Primitive index

| Primitive                                                               | When to use                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageShell`                                                             | Wrap every route's top-level content; `width="default"` (1120px) or `"narrow"` (720px — Settings; Import stays default)                                                                                                                                                          |
| `MobileNav`                                                             | The phone shell (app-level, not a `@sage/ui` export): bottom tab bar below `md`, sidebar above. Reads `navGroups`/`mobileTabs` from `lib/nav.ts` — never hard-code a route into it                                                                                               |
| `PageHeader`                                                            | One per page, inside `PageShell`: title + optional description + right-aligned `actions`                                                                                                                                                                                         |
| `SectionHeader`                                                         | Every in-page section heading; replaces ad-hoc `<h2>`/`label-caps`                                                                                                                                                                                                               |
| `Card`, `CardTitle`                                                     | The one card shell (wash + hairline, 16px radius); `compact` for dense bento tiles; `CardTitle meta` for right-aligned counts/totals                                                                                                                                             |
| `Stat`, `StatStrip`                                                     | Labeled numerals (`hero`/`md`/`sm`) with optional context line; `StatStrip` lays several `Stat`s out hairline-divided — no boxes                                                                                                                                                 |
| `Chip`                                                                  | Status/type/tag badges; `tone` (`neutral`/`primary`/`gain`/`loss`/`income`) + `variant` (`wash`/`outline`)                                                                                                                                                                       |
| `Delta`                                                                 | Every gain/loss figure — `variant="text"` inline, `variant="chip"` for hero usage; never hand-build a colored span                                                                                                                                                               |
| `RowGrid`, `RowHeader`, `DataRow`, `RowCell`                            | The readable-row contract: `RowGrid columns` sets the shared track list, `RowHeader cells` renders column caps, `DataRow` is one hoverable row, `RowCell primary/secondary` is a cell pair (`variant="text"` for identity cells, `"figure"` default for mono numbers)            |
| `EmptyState`                                                            | A list/section with nothing to show: one sentence + optional action                                                                                                                                                                                                              |
| `ErrorState`                                                            | A failed fetch: message + retry action                                                                                                                                                                                                                                           |
| `Skeleton`, `ChartSkeleton`                                             | Shimmer placeholders — compose each route's `loading.tsx` from these                                                                                                                                                                                                             |
| `SegmentedControl`                                                      | Pill tab/view switches (radio semantics), e.g. period toggles                                                                                                                                                                                                                    |
| `Button`                                                                | The only button; `default` = white/near-black pill CTA, `secondary`/`outline`/`ghost`/`destructive` for the rest                                                                                                                                                                 |
| `Popover`, `Dialog`                                                     | Shared Radix-backed overlay skins. `DialogContent size="lg"` (576px) for form dialogs; `DialogFooter` for their actions — secondary left, primary right, above a hairline                                                                                                        |
| `InfoTooltip`                                                           | Inline ⓘ trigger revealing a one/two-sentence explanation — click/tap opens a compact popover; use next to any figure needing a "what/why" aside (e.g. gross vs. net, a methodology caveat)                                                                                      |
| `Switch`, `Input`                                                       | Form primitives                                                                                                                                                                                                                                                                  |
| `Field`, `FieldRow`                                                     | Every form control: `Field` is label + control + hint/error with a real `<label for>`; `FieldRow` pairs two fields into columns that stack on narrow viewports. Never hand-roll a `<label>`, and never name a control with only a placeholder — it disappears on first keystroke |
| `Table*` (`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`) | Legacy HTML table, predates the readable-row contract — prefer the `RowGrid` family for new lists                                                                                                                                                                                |
| `Callout`                                                               | Inline banner for a status inside the page flow (`info`/`success`/`error`); stays next to whatever produced it                                                                                                                                                                   |
| `ToastProvider`, `useToast`                                             | Transient confirmation that a write landed — `toast({ title, description, tone })`. Mounted once in `app/providers.tsx`                                                                                                                                                          |
| `Separator`                                                             | Rare 1px hairline rule; whitespace is the default separator between sections                                                                                                                                                                                                     |
| `ThemeProvider`, `ThemeToggle`                                          | Dark/light theme wiring, dark is default                                                                                                                                                                                                                                         |
| `AllocationBars`                                                        | Labeled percent rows or a segmented bar + legend for allocation breakdowns (diversification, income composition)                                                                                                                                                                 |
| `RelativeScale`                                                         | Hairline track with a benchmark pinned at centre and the portfolio marked at its log₂-scaled ratio. Colourless by design — position is a fact, colour would be a verdict. Domain [0.5×, 2×]; out-of-domain markers clamp and are visibly marked                                  |
| `SageMark`                                                              | Brand mark SVG                                                                                                                                                                                                                                                                   |

## 4. Composing a new page

1. `<PageShell>` (pick `default` or `narrow`).
2. `<PageHeader>` — title, optional description, actions slot.
3. Sections as `<SectionHeader>` + `<Card>` (or bare `StatStrip`/`AllocationBars` where a card shell adds nothing).
4. Multi-column lists as readable rows (`RowGrid`/`RowHeader`/`DataRow`/`RowCell`), ≤4 data columns, human dates, `Delta` for every gain/loss figure.
5. Add the route's `loading.tsx` from the skeleton kit; wire `EmptyState`/`ErrorState` for empty and failed states — never a raw `<p>` or a blank flash.
6. Run `pnpm lint` before opening a PR.

## 5. Enforcement

`sage-design/no-off-token-classes` (custom ESLint rule, scoped to
`apps/web/**/*.tsx`) statically bans, in className string literals:

- arbitrary font sizes (`text-[…px]`, `text-[…em]`)
- off-token radii (`rounded-sm/md/lg/xl/2xl/3xl`, `rounded-[…]`) — `rounded-full` and the token radii (`rounded-card`/`rounded-control`/`rounded-badge`) are allowed
- raw Tailwind palette classes (`*-green-500`, `*-zinc-*`, …) and hex colors in class strings

The rule currently lands as `warn` — it is landing alongside this doc while
the sweep branches (`feat/design-sweep-core`, `feat/design-sweep-align`) still
have pre-existing violations to fix page by page. It flips to `error` once
those branches merge and the codebase is clean.

Known gaps this doc does not claim are done: `loading.tsx` is missing on most
routes; `EmptyState`/`ErrorState` have no consumers yet; the asset,
diversification, transactions, settings, and import pages have not been
transformed onto these primitives (that's branches 2–3, `feat/design-sweep-core`
and `feat/design-sweep-align`). This branch (`feat/design-system`) ships the
tokens, the primitives, this rulebook, and the lint rule — not the page sweep.
