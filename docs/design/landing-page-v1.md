# Kanvexa Landing Page — Approved Design V1

**Approval:** Approved by project owner, 25 October 2026.  
**Feature:** K3 — Public Landing Page  
**Design reference:** [`screens/reference/landing-page-v1.png`](../../../Kanvexa-K3-Landing-Page-Package/docs/design/screens/reference/landing-page-v1.png) (unmodified, 1024 × 1536).  
**Implementation evidence:** `docs/design/screens/implementation/public-landing-page/`.

## Design direction

Modern, polished SaaS marketing page, inspired by precise product-first layouts rather than an unrelated theme redesign. Clean white canvas, muted lavender glows, indigo/violet CTAs, dark headings, soft borders/shadows, large product visuals, restrained illustration.

**Non-negotiable:** this approved full-page image is the visual baseline for desktop composition. Implement HTML/React components, **not** a screenshot background. Mobile may adapt substantially as long as hierarchy, branding and polish remain intact.

## Visual hierarchy

1. **Header:** authentic Kanvexa logo + wordmark left; section anchors center; auth-aware actions right.
2. **Hero:** left-aligned eyebrow, large two-line headline *Organize work. Move together.*, concise body copy, two CTAs, subtle benefits; large tilted or layered realistic Kanban UI preview right.
3. **Features:** centered section introduction and four cards in one desktop row (Visual Boards, Real-time Collaboration, Team Management, Activity History).
4. **Product showcase:** layered authentic board/boards-screen imagery paired with benefit-led explanation and compact icon list.
5. **Closing CTA:** rounded lavender-gradient band with persuasive headline, one clear primary action and an optional secondary action.
6. **Footer:** real product links only, official brand, compact copyright.

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
- `/boards`, `/profile`, login/register, verification, all auth guards retain existing behavior.
- No paid plans, testimonials, fabricated testimonials/customer logos, invented user statistics, unreachable social icons, or broken footer URLs.

## Responsive rules

- **≥1280px:** desktop hero two-column and features 4-up where readable.
- **Tablet:** adjust hero/product-preview balance, support 2×2 features, avoid cramped button/title alignments.
- **≤640px:** stack hero copy, CTA and preview; features one-column or two-column if readable; compact mobile navigation; no horizontal overflow at 320px.
- Reduced motion alternative for animations, high contrast/readability, visible keyboard focus, semantic headings.

These are directional breakpoints, not a command to override established Tailwind breakpoints if better options exist.

## Visual QA acceptance

Compare the running page side by side with the approved V1 at desktop widths, looking at overall composition, hierarchy, size of hero preview, palette, card spacing, CTA prominence, consistent shadows and overall density. Capture real browser screenshots at desktop/tablet/mobile sizes and record deviations/intentional adaptation.

The screenshot is an approved **design target**, not production imagery to be placed as one large image.
