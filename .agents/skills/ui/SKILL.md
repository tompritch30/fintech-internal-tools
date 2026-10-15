---
name: ui
description: UI rules for every app page in apps/web (record layout, actions, badges, reveals, list filters). Use when adding or changing a page, a record view, or a component in packages/ui.
---

# UI rules

Every app uses the components in `packages/ui` (`@fit/ui`). Devin Review checks these rules
(REVIEW.md, section 6). The demo record (`app/(platform)/demo-record/page.tsx`) is the reference.

## 1. One record layout

Every record page has this shape, in this order:

1. `RecordHeader`: title, status (`StatusBadge` value) and owner. Optional `back` link and
   `ownerLabel` ("Requested by", "Merchant"). Nothing else in the header.
2. One `ActionPanel`: the only place a record's actions live.
3. `RecordSection`s with titles such as **Details**, **Documents**, **Decision**, **History**.
   Use `fields` for label/value grids. History is `<Timeline>` fed by the audit log.

List pages use `PageHeader` + `ListView` (+ `Tabs` or `FilterBar` for filters).

## 2. No one-off styling in app pages

App pages may use layout classes only (`stack`, `flex`, `gap-*`, `grid`, widths). Colours,
borders, shadows, rounded cards, badge styling and form chrome come from `@fit/ui`.
Links use `linkClass`. If a page needs a new visual pattern, add a component to
`packages/ui` and use it from there, so the next app gets it too.

## 3. Never render an action the user can't take

- Work out the available actions on the server, in a pure function per app
  (`record-actions.ts`), and unit-test it. Check permission **and** state **and** business
  rules (e.g. the requester can't approve their own request; only the case owner decides).
- Render only those actions inside `ActionPanel`. With none, pass `waiting`: a neutral line
  saying what the record is waiting for ("You requested this refund. Waiting for a
  different approver."). Never a disabled button, never a button the server will refuse.
- Hiding is a convenience: every server action still enforces the rule (`defineAction`).
- Actions that need input open an `ActionDialog`; one-click actions use `ActionButton`.

## 4. Badges: neutral by default

Use `StatusBadge` with a `kind`; never pick a `Badge` tone in an app page.

| kind | colour | use for |
|---|---|---|
| `neutral` (default) | grey | every ordinary status: open, in review, pending, escalated, rejected, cancelled, roles, audit actions |
| `risk` | red | genuine risk only: high risk rating, sanctions hit, PEP |
| `done` | green | completed only: refunded, approved and closed, fully refunded |

`STATUS_TONE` in `StatusBadge.tsx` is the only kind→colour map.

## 5. Reveals

A masked value gets one `RevealButton` next to it (documents: `display="block"`). The button
opens a dialog that asks for the reason (`minReasonLength={MIN_UNMASK_REASON_LENGTH}`).
The server action checks `pii:unmask`, writes the audit row and returns the value. Never
render inline reason boxes per field or per document.

## 6. Filters

Queues: `ListView` search plus `Tabs` for a status. Logs and anything with several criteria:
a `FilterBar` of labelled fields (dates, selects, text), with `ListView search={false}` and the
filter values passed as `params` so sort and paging links keep them. State lives in the URL.

## 7. Check before opening the PR

Screenshot every changed page as each demo user (`analyst`, `approver`, `senior`, `admin`,
`norole`) and check it against rules 1–5: one layout, no stray styling, no action the user
can't take, badge colours, one Reveal button per masked value.
