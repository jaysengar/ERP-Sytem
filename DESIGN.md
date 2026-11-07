# Smart Retail interface

Operate mode. The user's pinned white/light and navy dashboard brief is authoritative. Familiar sidebar navigation, task-oriented tables and a two-column billing workspace. Concept seed: seed:6689d7dc89841fa3 (degraded, no catalog challengers). The selected direction borrows the precise typography and restrained palette of clothing care labels: a small square woven-mark logo, clear metadata and orderly spacing, without copying physical artifacts into controls.

## Tokens
- Canvas #f5f7fa; surface white; navy #172e50; text #172b49; secondary #637187; border #e5eaf0.
- Green confirms completed activity, amber identifies stock requiring attention, red marks destructive or invalid actions.
- Segoe UI/system sans, 14px body, 13px controls/data, 12px secondary text, 28px page headings, tabular numbers, 4/8px spacing scale. Mobile text inputs are 16px to avoid focus zoom. The logo tagline, navigation section label and compact badges use smaller supporting text.
- 12px panels, 8px inputs/buttons. Borders for panels, soft offset shadow for floating overlays only.
- Desktop sidebar 240px; collapses into a focus-contained drawer below 1050px. Closed mobile navigation is inert. Mobile forms use a single column; billing switches between Products and Current bill, with a persistent view-bill action when items are selected.
- Desktop sales use a table; mobile sales use compact invoice summaries. Other tables retain readable columns in labeled scroll containers, with a sideways-scroll hint when needed.

## Interaction
Native controls and dialogs with focus management, visible focus, field labels, validation, loading and empty states. Route titles get keyboard focus. Reduced motion supported. Sales and purchases require explicit review; only owner can delete, change staff or settings. Demo permissions are not authentication.

Forms show field-level validation and a linked error summary without clearing entered values. Backdrop clicks do not dismiss forms. Required marks sit outside the accessible label; native required semantics announce the requirement. Route loading preserves the shell, the header names the current page and the profile control opens an explicit menu. Search/filter URL changes replace history and use the latest pending query to avoid reviving cleared filters.

Mobile dialog actions stay within the visible dialog, with scroll padding keeping focused fields clear of sticky headers and footers. Switching the mobile billing workspace places focus on the selected workspace control. The skip link remains available to keyboard users without appearing during pointer interaction.

The November refinement retains the original palette and information architecture. It corrects undersized text, mobile overflow, inaccessible off-screen navigation and the long mobile path from products to checkout. Screenshot and print evidence is in `artifacts/ui-after/`.

## UI/UX Pro Max refinement

The follow-up refinement keeps the same identity, Lucide icons and desktop information density. Product filters now have persistent labels, a contextual result count and removable selections that wrap. Removing a selection returns focus to its filter. Table headers expose the active sort direction; small product and sorting controls have larger hit areas, including 44px controls for narrow/coarse-pointer use.

Product entry is split into native fieldsets for details, size/colour, and pricing/stock. Photo and variant-group fields remain available in an optional disclosure. A focusable error summary appears at the top of forms; its links open any containing disclosure before focusing an invalid field. Product form actions remain reachable while scrolling.

POS uses one contextual live message for cart changes, visible search/barcode labels and a checkmark on the selected payment method. Invalid mobile numbers are explained next to the field when Review is pressed, then focus returns to that field. Validation does not move the Review button during a blur/click sequence.

Verified skill search matches: **Focusable Error Summary** and **Contextual Live Badge Updates** (`ux`), and controlled form inputs (`react`, used for the existing interactive POS state). Searches for grouping/disclosure and sort semantics did not return specific matches after one retry; those decisions use the skill's general Quick Reference sections 8 and 10. The established uncontrolled product form remains appropriate for native FormData submission. No generated design system replaced this document.

Latest evidence is in `artifacts/ui-pro-max/`. The shared styles add semantic surface/control tokens and a small disclosure transition that respects reduced motion.
