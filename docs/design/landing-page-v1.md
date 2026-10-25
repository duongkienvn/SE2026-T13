# Kanvexa Landing Page — Approved Design V1

**Approval:** Approved by project owner, 25 October 2026; **Navigation Addendum V1.1** approved same day (three distinct in-page anchors).  
**Feature:** K3 — Public Landing Page  
**Design reference:** [`screens/reference/landing-page-v1.png`](screens/reference/landing-page-v1.png) (unmodified, 1024 × 1536).  
**Implementation evidence:** `docs/design/screens/implementation/public-landing-page/`.

## Design direction

Modern, polished SaaS marketing page, inspired by precise product-first layouts rather than an unrelated theme redesign. Clean white canvas, muted lavender glows, indigo/violet CTAs, dark headings, soft borders/shadows, large product visuals, restrained illustration.

**Non-negotiable:** this approved full-page image is the visual baseline for desktop composition. Implement HTML/React components, **not** a screenshot background. Mobile may adapt substantially as long as hierarchy, branding and polish remain intact. **Approved deviation:** add a compact 3-step `How it works` section between Features and the existing Product Showcase; the latter serves as the `Why Kanvexa` anchor destination. The original mockup image stays unchanged.

## Visual hierarchy

1. **Header:** authentic Kanvexa logo + wordmark left; **exactly three** in-page anchors (`Features`, `How it works`, `Why Kanvexa`) center; auth-aware actions right.
2. **Hero:** left-aligned eyebrow, large two-line headline *Organize work. Move together.*, concise body copy, two CTAs, subtle benefits; large tilted or layered realistic Kanban UI preview right.
3. **Features** — `<section id="features">`: centered section introduction and four cards in one desktop row (Visual Boards, Real-time Collaboration, Team Management, Activity History).
4. **How it works** — `<section id="how-it-works">`: compact, elegant 3-step explanation **Create a board → Organize tasks → Collaborate in real time**. Responsive layout with icons and subtle connecting visual accents; designed in the same palette and spacing as V1.
5. **Why Kanvexa / Product showcase** — `<section id="why-kanvexa">`: use the **existing V1 “Built for real teams / A better way to manage your work” composition**, with layered authentic UI preview and benefit-led explanation. **Do not add a redundant second benefits block.**
6. **Closing CTA:** rounded lavender-gradient band with persuasive headline, one clear primary action and an optional secondary action.
7. **Footer:** real product links only, official brand, compact copyright.

## Source of truth / brand

- Use existing React `Brand` and `BrandLogo` components from `apps/frontend/src/components/Brand.tsx`.
- They use `/branding/kanvexa-logo-v1.png` from `apps/frontend/public/branding/`.
- **Never repaint, trace, substitute, or recolor the official mark to match the AI mockup.**
- Use existing product UI or genuine captured screenshots for Board preview; do not advertise unshipped features. Mockup faces/avatars, cards, and marketing text are illustrations, not evidence of actual users/customers.
- Existing typography is Inter; prefer design tokens and styling conventions in the app.

## Behavioral rules

- `/` is a public page available to signed-in and signed-out users, without automatic redirect.
- Signed-out: Get Started → `/register`, Log in → `/login`, Learn more → actual section anchor.
- Signed-in: primary action → `/boards`; don't force through guest auth flow.
- Header links use `<a href="#features">`, `<a href="#how-it-works">`, `<a href="#why-kanvexa">`; three distinct section IDs, never three separate routes and never a dead link. Hero `Learn more` goes to `#features`.
- Anchor navigation should preserve URL hashes and work with direct `/#...` loading/reload, browser history, mouse/keyboard and mobile menu. Account for sticky header (`scroll-margin-top` or equivalent); smooth scroll only where motion preference allows it (`prefers-reduced-motion: reduce` gets immediate scroll).
- No `href="#"` placeholders or decorative nonfunctional controls.
- `/boards`, `/profile`, login/register, verification, all auth guards retain existing behavior.
- No paid plans, testimonials, fabricated testimonials/customer logos, invented user statistics, unreachable social icons, or broken footer URLs.

## Responsive rules

- **≥1280px:** desktop hero two-column and features 4-up where readable.
- **Tablet:** adjust hero/product-preview balance, support 2×2 features, avoid cramped button/title alignments.
- **≤640px:** stack hero copy, CTA and preview; features one-column or two-column if readable; compact mobile navigation; no horizontal overflow at 320px.
- Reduced motion alternative for animations, high contrast/readability, visible keyboard focus, semantic headings.

These are directional breakpoints, not a command to override established Tailwind breakpoints if better options exist.

## Visual QA acceptance

Compare the running page side by side with the approved V1 at desktop widths, looking at overall composition, hierarchy, size of hero preview, palette, card spacing, CTA prominence, consistent shadows and overall density. The new compact **How it works** strip is a deliberate approved V1.1 addition; its presence must not be used to justify redesigning the rest of V1. Verify all three anchor positions, target headings, URL hashes, mobile behavior, and reduced-motion fallback. Capture real browser screenshots at desktop/tablet/mobile sizes and record deviations/intentional adaptation.

The screenshot is an approved **design target**, not production imagery to be placed as one large image.
