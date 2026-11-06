# Handoff 29/09/2026 — Partial deploy: stage-gated bypass + hidden OP pages

## Goal of this session
For the partial deploy (served at `http://localhost:443/labventure/`, with BellBeast proxying to the Express server):
1. Login bypass buttons depend on the AquaDAT stage, and a secret hotkey shows a Super Admin bypass.
2. Hide the OP pages from everyone except a Super Admin **bypass** session.

## Status
All changes are done, and the client has been rebuilt to `client/dist` (already live). **The server has not been restarted**, so the new `/api/auth/bypass` guard is not active yet: run `cd server && npm start`. Nothing has been committed. The working tree also has many other uncommitted changes from earlier sessions (see `git status`).

## Behaviour now
| Stage | Login page |
|---|---|
| `1` (AquaDAT up) | AD login form only. No bypass buttons. |
| `0` or `2` (offline) | Offline banner and bypass buttons for **Scientist and Operator only**. No AD form. |
| any | **Ctrl+Shift+F12** shows the Super Admin bypass button (show-only, not a toggle). |

The server guard `/api/auth/bypass` accepts only `superadmin` at stage 1. At any other stage it accepts `scientist`, `operator` and `superadmin`. Any other role gets a 403. This fits the stage-0 auto-switch in `Record.jsx` (around line 590), which calls bypass as `scientist`.

Hidden pages: `op-dashboard` and `op-record` are hidden from the menu **and** from routes (a direct URL redirects to the first allowed page) for every account except `me.bypass && me.role === 'superadmin'`. A normal AD login matched as superadmin by name (`role` = null) also can't see them.

## Files changed
- `client/src/config/pageAccess.js` (**new**): single source for `ROLE_PAGES`, `PAGE_ROUTES`, `HIDDEN_PAGES`, `isSuperBypass(me)` and `allowedPagesFor(me)`. To show the OP pages again, set `HIDDEN_PAGES = []`.
- `client/src/App.jsx`: `RequireAuth` uses `allowedPagesFor(data)`. The duplicate ROLE_PAGES/PAGE_ROUTES were removed.
- `client/src/components/Layout.jsx`: NAV filter uses `allowedPagesFor(me)`. The duplicate ROLE_PAGES was removed.
- `client/src/pages/Login.jsx`: `offline = stage===0||stage===2`, the bypass list cut to 2 roles, a `showSuper` state plus a keydown listener, and a `bypassButton()` render helper.
- `server/routes/auth.js`: stage-based role allowlist at the top of `POST /bypass`.

## Verified (browser, stage 1)
- The login shows only the AD form. After Ctrl+Shift+F12 the Super Admin button appears.
- The Super Admin bypass shows OP ภาพรวม and OP บันทึก in the nav.
- The Operator bypass nav shows only รับสารเคมี / CAR Log / รายงาน, and `/op-dashboard` redirects to `/chem-intake`. This test only worked because the server hadn't been restarted yet.
- **Not verified:** the stage 0/2 UI in the browser (the system was on stage 1), and the server 403 guard (needs a restart).

## Open items / next steps
1. Restart the server, then check that `POST /api/auth/bypass {role:"operator"}` at stage 1 returns 403 and `{role:"superadmin"}` returns 200.
2. If possible, test with stage 0 or 2. The stage comes from `services/stageMonitor.js`, which polls `BELLBEAST_STAGE_URL` every 30s and keeps the old value when the poll fails.
3. Commit when the user asks (branch `master`; it has a lot of mixed uncommitted work, so commit only these files or ask the user first).
4. Server-side, the OP pages are only hidden in the UI. `/api/operator/*` is not blocked. Add a guard if needed.

## Suggested skills
- `run`: start or drive the app to test stage 0/2 and the server guard.
- `code-review` (low/medium): review the diff of the 5 files above before committing.
- `scrutinize`: if you want to go through the auth/bypass flow end-to-end (for example, whether a fake-JWT bypass token needs more hardening).
