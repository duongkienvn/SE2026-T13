# Final landing page and password recovery polish

Implemented from the final user-supplied landing mockup and the existing modern
Login composition. This is local implementation and browser evidence, not a deployment record.

## Changes

- All nine approved areas: navigation/hero, six features, three steps, realtime
  showcase, Why Kanvexa/Card Detail, three workflows, six FAQs, final CTA and footer.
- Responsive light/dark styling, official branding and reusable static product
  artwork. Illustrations represent the approved product vision; they contain no
  focusable controls, business-data requests, production data or availability badges.
- Existing session-aware CTA destinations remain intact. Guest CTAs use `/register`;
  signed-in users retain their Board destinations. Footer links use existing anchors,
  auth routes and the verified public repository/README on its `main` branch.
- Forgot Password and Reset Password reuse `AuthEntryLayout` and modern form
  primitives. Login/Signup source and authentication business logic are unchanged.
  Recovery validation, generic confirmation, cooldown, session checks and token
  handling are preserved. Account Security keeps the default password-form styling.
- Native FAQ disclosure semantics; Escape closes the mobile menu and restores focus.

## Validation

- `pnpm --filter @kanban/frontend test --` with LandingPage, AuthEntryLayout,
  PasswordRecovery, LoginPage, RegisterPage and AccountSecurity test files:
  **6 files, 78 tests passed**.
- `pnpm exec eslint apps/frontend`: **passed**.
- `pnpm --filter @kanban/frontend build`: **passed** (TypeScript and Vite).
  Vite reports an environment `NODE_ENV` warning and a bundle larger than 500 kB.
- Changed-file Prettier and `git diff --check`: **passed**.
- Chrome browser QA at 1440×900 and 375×812, both themes: no page horizontal
  overflow; all sections and artwork inspected. Reduced-motion preference checked.
- Verified keyboard FAQ Space/Enter, mobile menu Escape/focus restoration and FAQ
  anchor closure/scroll, Features scroll offset, Signup CTA and Back to login.
- Recovery empty/invalid input focuses the email field without a request. Browser
  response fixtures verified generic success/cooldown and a recoverable server error.
  No actual recovery email was sent. Security behavior is covered by focused tests.
- Visiting Signup on the isolated local QA port reports a Google client origin
  restriction. Live Google OAuth was not exercised; its configuration is unchanged.
- No backend, database or full-suite checks: outside this frontend-only scope.

## Screenshots

| Page            | Desktop light                                                                                      | Desktop dark                                                                                     | Mobile light                                                                                     | Mobile dark                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Landing         | [1440 light](../../design/screens/implementation/landing-auth-final-polish/landing-1440-light.jpg) | [1440 dark](../../design/screens/implementation/landing-auth-final-polish/landing-1440-dark.jpg) | [375 light](../../design/screens/implementation/landing-auth-final-polish/landing-375-light.jpg) | [375 dark](../../design/screens/implementation/landing-auth-final-polish/landing-375-dark.jpg)                 |
| Forgot Password | [1440 light](../../design/screens/implementation/landing-auth-final-polish/forgot-1440-light.jpg)  | [1440 dark](../../design/screens/implementation/landing-auth-final-polish/forgot-1440-dark.jpg)  | [375 light](../../design/screens/implementation/landing-auth-final-polish/forgot-375-light.jpg)  | [375 dark, success fixture](../../design/screens/implementation/landing-auth-final-polish/forgot-375-dark.jpg) |
