# Kanvexa Design Documentation

Kanvexa's interface covers Workspaces, Board and Card views, productivity, collaboration and account settings. The [project overview](../project-overview.md) describes implemented capabilities; this directory records design authority and visual evidence.

## Branding and implementation foundations

Use the official `Brand` / `BrandLogo` components and Kanvexa artwork in `apps/frontend/public/branding/`. Reuse the semantic color, typography and spacing tokens in `apps/frontend/src/style.css` and the shared UI components. Preserve light, dark and system appearance, responsive navigation, visible focus and accessible controls.

- [Base design guidelines](design-guidelines.md): branding, shared UI foundations and original screen baselines.
- [Design addendum](design-guidelines.post-mvp.md): theme, layout and interaction extensions used by the current application.
- [Product & UX Blueprint](product-ux-blueprint.md): access, navigation and interaction decisions.
- [Visual reference register](post-mvp/visual-reference-register.md): the approved image/spec pairing for each application area and its text overrides.

Some source documents retain their original MVP/Post-MVP names, dates and planning language. Those names describe design history, not a split between the currently available and future product. Follow later approved screen-specific decisions where a reference has been superseded; a mockup is never permission to add unsupported features.

## References and product captures

| Location                                             | Purpose                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`screens/reference/`](screens/reference/)           | Approved visual targets. These are design inputs, not screenshots of a deployed product.  |
| [`post-mvp/`](post-mvp/)                             | Screen specifications and approved compositions for the expanded application.             |
| [`screens/implementation/`](screens/implementation/) | Actual browser captures from implementation and verification, often using synthetic data. |
| [`../tasks/frontend/`](../tasks/frontend/)           | Scope, approved deviations and verification context for those captures.                   |

Implementation captures remain evidence of the version and scenario that produced them. Older captures can show superseded layouts or controls that were unavailable at that time; do not present them as current production screenshots. The [account security and privacy captures](screens/implementation/p5-account-security-privacy-ui/) include the implemented Settings interface. The [root README preview](../../README.md#product-preview) uses an existing capture rather than an old Board layout.

## Original reference catalog

These references are retained for traceability. Later decisions recorded in the guidelines, register and task records govern screens that have since changed.

| Reference                                             | Original purpose                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| [Login](screens/reference/login.png)                  | Original login screen; see the Auth V2 override in the base guidelines. |
| [Boards](screens/reference/boards.png)                | Board discovery baseline.                                               |
| [Kanban Board](screens/reference/kanban-board.png)    | Board work surface baseline.                                            |
| [Card detail](screens/reference/card-detail.png)      | Card detail baseline.                                                   |
| [Members](screens/reference/team-members.png)         | Board-member management appearance.                                     |
| [Landing page](screens/reference/landing-page-v1.png) | Public landing page composition; [specification](landing-page-v1.md).   |

## Adding or changing UI documentation

Keep new implementation screenshots under `screens/implementation/<task-slug>/`, separate from approved design references. Link them from the relevant task record and state the data source, viewport and verification context. Capture new images only when needed to verify or explain a change.

Document real capabilities and permission states. Do not turn sample people, counts or Board data into production content. Preserve the exclusions on pricing, subscriptions and unsupported controls. Historical roadmaps and task evidence remain available through the [task index](../tasks/README.md) and [planning archive](../roadmap/post-mvp.md).
