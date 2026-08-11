# shadcn/ui + Radix UI in the GateTest website

Craig authorized these 2026-08-12 — *"these should be available to us for any coding
session to help with output"*. Boss Rule #2 (new dependencies) is **satisfied** for
shadcn/ui, Radix primitives, and the four base packages shadcn requires. No future
session needs to re-ask.

## What is already wired up

| Piece | Where |
|---|---|
| Base deps | `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` in `website/package.json` |
| `cn()` helper | `website/app/lib/cn.ts` |
| CLI config | `website/components.json` (components → `app/components/ui`, utils → `@/app/lib/cn`) |

Radix primitives are **not** pre-installed: `npx shadcn@latest add <component>` pulls
only the ones that component needs. Add components from `website/`.

## READ THIS BEFORE RUNNING `shadcn add` — the token collision

`npx shadcn@latest init` was deliberately **not** run. Its job is to write shadcn's
default token block into `app/globals.css`, and two of those tokens already exist here
with **different meanings**. Letting the CLI overwrite them would silently restyle the
whole site.

| Token | Meaning in `globals.css` today | Meaning to shadcn | Call sites at risk |
|---|---|---|---|
| `--muted` | a **text** colour (`#6b7280`, mid-grey) | a **background** fill (light grey) | 482 uses of `text-muted` |
| `--accent` | the **brand teal** (`#0f766e`) | a subtle **hover background** | 486 uses across `bg-surface` / `text-accent` / `border-border` |

`--background`, `--foreground`, and `--border` happen to agree with shadcn's semantics
and need no special handling.

If shadcn's definitions won, `text-muted` on 482 call sites would render mid-grey body
copy as a grey block fill, and every teal accent would flatten to a hover tint.

### The rule when you add a component

1. Run `npx shadcn@latest add <component>` from `website/`.
2. **Diff `app/globals.css` before committing.** If the CLI appended a `:root` block
   redefining `--muted` or `--accent`, revert those two lines. Keep any genuinely new
   tokens it adds (`--primary`, `--ring`, `--input`, `--card`, `--popover`,
   `--destructive`, `--secondary`, `--muted-foreground` — none of these collide).
3. In the generated component source under `app/components/ui/`, rewrite the two
   colliding utilities onto our palette:
   - `bg-muted` → `bg-surface-light`
   - `text-muted-foreground` → `text-muted`
   - `bg-accent` → `bg-surface-light`
   - `text-accent-foreground` → `text-foreground`
4. Render the component on a real page and look at it in both the light body and the
   dark `.hero-dark` / `.product-card` surfaces before shipping.

shadcn is copy-paste source: components land in the repo, so step 3 is a one-time edit
per component, not a permanent patch.

## Why this file exists

The site has a mature bespoke design system (elevation scale, radius scale, teal accent,
glass/terminal/product-card treatments). shadcn is here for **structural** components
where Radix earns its keep — dialog, popover, dropdown, tabs, tooltip, accordion,
command palette — i.e. the accessibility-hard, focus-management-hard primitives. It is
not a licence to replace the existing visual language with stock shadcn styling.
