# Pathfinder v2 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement the supplied November 21 specification on frontend/ui-development, including its six-action demonstration and a compatible server contract.

**Architecture:** Keep the existing Next.js/React/TypeScript stack and legacy planner. Add a serializable v2 domain and server evaluator, with shared date utilities and browser repositories. The new UI consumes the server evaluation for both cards and daily roadmap bars. Saved plans retain immutable input and evaluation snapshots.

**Tech Stack:** Next.js 15, React 19, TypeScript, Zod, Vitest; no new runtime dependencies.

**Spec:** docs/superpowers/specs/2026-11-21-pathfinder.md

## Global Constraints

- Browser storage is the initial release scope; actual authentication and cross-device storage are conditional follow-up work (§9.2).
- Keep legacy /api/judge fields and callers; add optional plannerV2.
- Demo fixture clock: 2026-11-19. User mode uses server Asia/Seoul date. Demo data is visibly synthetic.
- Never use model prose to decide dates, eligibility, selection or conflicts; no new external AI calls for basic interactions.
- Preserve the user-designated frontend/ui-development checkout. Do not commit, push or deploy implementation without a further request.
- Dates are valid YYYY-MM-DD, intervals inclusive on display, stable event/stage IDs, unique offering choices.
- Navy #192655, blue #3876BF, sand #E1AA74, cream #F3F0CA; responsive 360px to desktop, accessible dialogs.

## Review Focus

- Rapid date changes and failed requests must retain the last confirmed state and reject stale revisions.
- Corrupt or unavailable storage must not report success or destroy healthy records.
- Date changes must retain selected offerings and warn when their original stage disappears.
- Unknown restrictions and actual participation cannot be bypassed through replacement or recommendations.
- Viewing/re-evaluating/copying a saved plan must never mutate the original draft or saved snapshot.

### Task 1: Dates, stages and server evaluation

**Files:** lib/planner/{types,dates,fixtures,evaluate,catalog,schema}.ts; lib/judge/handler.ts; tests/planner/evaluate.test.ts

**Interfaces:** evaluatePlanner(profile, input, catalog, now) → Evaluation; optional JudgeBody.plannerV2. Dates, stages, warnings and sorted cards are all server-derived.

- [x] Add failing tests for D−61→D−85→blocked, stable IDs, continuous windows, leap dates, same-day events, closure time, conflicts, recommendations, validation and legacy compatibility.
- [x] Run `npm test -- tests/planner/evaluate.test.ts`; implement and confirm green.
- [x] Adapt real policy/round data conservatively; only reviewed rules can establish eligibility.

### Task 2: Immutable drafts, browser plans and schedule commands

**Files:** lib/planner/{state,storage,commands}.ts; tests/planner/state.test.ts

**Interfaces:** changeEvents / undoEvents preserve choices; createPlanRepository(Storage) exposes listPlans/getPlan/createPlan; parseScheduleCommand returns explicit commands or clarification.

- [x] Add failing tests for undo, saved snapshots, independent records, corruption, write failures, legacy preservation and ambiguous agent dates.
- [x] Implement and run `npm test -- tests/planner/state.test.ts`.

### Task 3: New planner experience

**Files:** app/page.tsx; app/workspace/{Planner,Schedule,PolicyCard,Dialogs,Roadmap,Agent,Modal,workspace.module.css}.tsx (CSS separate); app/legacy/page.tsx

**Interfaces:** UI sends plannerV2 inputs and renders Evaluation; calendar/agent use the same event mutation; board/grid/detail share PolicyCard; all plan surfaces use one selected snapshot.

- [x] Preserve the existing planner at /legacy; implement entry/account/profile, shell and responsive navigation.
- [x] Implement dated schedule/calendar, undo, draft summary, category/unavailable filters, incremental columns/grid/detail, choice move/replacement.
- [x] Implement recommendation summary/diff, browser save dialogs, roadmap picker/bars/copy/re-evaluation and contextual agent.
- [x] Check `npx tsc --noEmit` and `npm run lint`, then smoke-test server entry and judge API.

### Task 4: Acceptance and review

**Files:** tests/planner/*.test.ts; docs/superpowers/plans/2026-11-21-pathfinder-progress.md; README.md

- [x] Run full `npm test`, `npm run lint`, `npm run build` and API smoke checks.
- [x] Fresh reviewer checks specification coverage and concrete regressions; address important findings and add regression tests.
- [x] Record verified scope and any actual limits; leave changes on the requested branch.
