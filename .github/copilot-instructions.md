# Copilot instructions for flowyblog-framework

## Repository purpose

This repository is a static blog framework built with Next.js 16, TypeScript, Tailwind CSS, and MDX. Content is authored as MDX in `src/content`, then rendered into a static export for Cloudflare Pages. The app is designed around a no-database content pipeline: article metadata and body text are read directly from the filesystem at build time.

The key operational goal is to keep the static export stable. CI explicitly checks export output, custom 404 pages, sitemap generation, trailing-slash route shape, and a few regressions that matter on Cloudflare Pages.

## Build, test, and lint commands

Use the project scripts from the repository root:

```bash
pnpm install
pnpm typegen                # generate Next.js route types
pnpm dev                    # local dev server
pnpm build                  # production build / static export
pnpm typecheck              # TypeScript validation (tsc --noEmit)
pnpm lint                  # ESLint
pnpm test                   # runs scripts/test-toc.ts; checks TOC, reading time, and draft filtering
pnpm test:theme             # checks theme-related CSS assumptions
pnpm test:server -- 3001    # Windows helper to start a test server on a specific port
pnpm preview:cf            # preview the static build with Wrangler and Pages Functions
```

Focused validation for this repo:

```bash
# after starting the dev server in one terminal
BASE_URL=http://localhost:3000 pnpm exec tsx scripts/test-toc.ts
```

This is the closest thing to a single targeted regression test: it compares generated table-of-contents IDs against the rendered HTML for the newest article and validates metadata rules such as draft filtering and inline-code heading slugs.

Fresh clones may need this sequence before `typecheck` works correctly:

```bash
pnpm typegen
pnpm typecheck
```

The CI workflow in `.github/workflows/ci.yml` is the canonical quality gate. It also asserts that the built output contains the required static pages and does not leak `/_next/image` optimizer URLs into exported HTML.

## High-level architecture

- `src/app/`: Next.js App Router pages (`/`, `/blog`, `/tags`, `/about`, `/settings`, `/search`, admin routes, static export routes)
- `src/components/`: UI layer for navigation, blog cards, comments, reading progress, search UI, experimental lab panels, and other page chrome
- `src/lib/`: core logic and shared configuration; this is where the project’s behavior and data shaping live
  - `site.ts`: single source of truth for site name, author, URL, repo links, nav items, and global content metadata
  - `posts.ts`: filesystem-driven content loader, draft filtering, date sorting, reading-time estimation, and TOC extraction
  - `search-index.ts`: build-time search index generation for static search pages
  - `theme.ts` and `labs.ts`: theme/lab initialization scripts for no-flash startup behavior
- `src/content/`: all blog posts as `.mdx` files; each post is a source file, not database rows
- `public/`: static assets served directly; these must be copied into the static export without relying on Next image optimization
- `functions/`: Cloudflare Pages Functions; these are not covered by the app build and need syntax checking separately
- `scripts/`: onboarding and validation logic, especially setup files and the TOC regression script

The project is intentionally designed to remain mostly static. Search, archive pages, tag pages, and sitemap generation are all derived from content files at build time rather than a runtime API or database.

## Key conventions specific to this codebase

- Article source files live under `src/content/*.mdx`. Filenames become URL slugs; the slug is not the primary sorting key.
- Every post should export `metadata` in MDX form:

```mdx
export const metadata = {
  title: "Article title",
  date: "2026-10-11",
  publishedAt: "2026-10-11T20:30",
  description: "Short summary",
  tags: ["example"],
  draft: false,
};
```

- `date` is required and uses `YYYY-MM-DD`. `publishedAt` is optional and is used for same-day ordering precision.
- `draft: true` posts are excluded from `getAllPosts()` and never show up in the build output.
- The body should not start with a top-level `#` heading; the page header renders the article title. Only `##`/`###` headings should appear in the MDX content body so the TOC is correct.
- Keep heading IDs stable across TOC generation and search indexing. The code intentionally shares the same `stripMath` and `github-slugger` logic in `src/lib/posts.ts` and `src/lib/search-index.ts` so anchor links do not drift.
- Site-wide customization is centralized in `src/lib/site.ts`, not spread across components. Change the site name, URL, repo links, author, and footer config there.
- Static assets are versioned via `withAssetVersion` when they need cache-busting. Do not assume a file in `public/` can be changed without updating the asset URL logic.
- The repo deliberately avoids a backend for core blog functionality. If you are tempted to add a database or server state, confirm whether an existing static build path already satisfies the goal.
- Keep secrets out of the repo: `.setup/` and `.dev.vars` are explicitly sensitive and should not be committed or shared.

## Practical guidance for edits

- If you add or rename a post, expect archive/tag/search pages to regenerate from file-system scanning; no manual registry is required.
- If you change markdown heading behavior, validate both TOC and search indexing together; these are intentionally coupled.
- If you change an image or static asset path, verify the exported output still has the asset in `out/` and that there are no `/_next/image?url=` references in the static HTML.
- If you change the route structure or layout behavior, run `pnpm typecheck` and `pnpm build` before wrapping up.
- If you are altering Cloudflare Pages behavior or Functions, check the syntax of `functions/*.js` as well as the Next static export.

## Files to read first when onboarding

- `README.md` for project setup and authoring rules
- `src/lib/site.ts` for site-wide configuration and static metadata
- `src/lib/posts.ts` for content loading, sorting, drafts, and TOC logic
- `src/app/layout.tsx` for theming and startup scripts
- `.github/workflows/ci.yml` for the repo’s actual guardrails and build expectations

This is the minimum set needed to understand the framework’s big picture without reading the entire codebase.
