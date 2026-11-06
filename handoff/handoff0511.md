# Handoff 2026-11-05 — Annunciator (ESP32) redesign + MHxView/BellBeast test signal & lab views

Session ran 2026-11-04 → 05, **off-site** (PC = the Fullscale server, but no site network: Aquadat/PTC/SCADA/WiFi `.@MWA WiFi` unreachable).
Nothing in any repo is committed (user rule: commit only when asked). Board `ann-ac1808` on COM9 is plugged into this PC.

## 1. Where things stand

| Piece | State | Detail lives in |
|---|---|---|
| Design rev 5 (alarm + touch LAB pages + test signal) | done, deployed 2026-11-04 | `iot\Re-plan\iot-device_redesign0411.md` (§10 decisions) · `iot\deploy_0411\DEPLOY.md` |
| Lab glance follows lab alarms (fw 1.1.1) | done | same doc §10 last row |
| HOME = scenario/epidemic band + 4×4 lab values (fw **ann-1.2.0**) | flashed COM9 + BellBeast deployed 2026-11-05 ~13:00 | `iot\Re-plan\iot-device_scenario_home0511.md` · `iot\deploy_0511\DEPLOY.md` |
| BellBeast `/Admin/Annunciator` tab (live simulator of the device screen) | deployed 2026-11-05 ~13:12, verified logged-in with real data | `iot\deploy_0511_tab\` (bundle + apply.ps1) |
| Mockup | final | `iot\annunciator_lab_ui_mock.html` |

Live Fullscale_V2 now runs: Uroboros (TestSignal prefix), BellBeast (glance + dots + `/api/device/lab/scenario` + Fleet `lab_sec/scn_sec` + Annunciator tab), LabVenture (test panel default TTL 15 min + warning).
Backups before each deploy: `Fullscale_V2\_backup\redesign_0411_20261104_195452\`, `…\scenario_home_0511_20261105_125830\`, `…\annunciator_tab_0511_20261105_131139\`.

## 2. Open / next (site day)
1. Run the checklists: `iot\deploy_0411\DEPLOY.md` §3 (+9b) and `iot\deploy_0511\DEPLOY.md` "ตรวจที่ไซต์" — screen/touch/Thai font/sound on the real board, live test inject, scenario change → band + colours ≤ 30 s, epidemic, `[ทดสอบ]` band.
2. Approve `ann-ac1808` in `/Admin/Fleet` (still pending) so Fleet config (zones, `scn_sec`, …) reaches the board.
3. Ask user about **commit** for: `C:\Users\peera\esp\xiaozhi-esp32`, `BellBeast\BellBeast`, `Uroboros\Uroboros`, `LabVenture` (all dirty with earlier unrelated work too — commit only this session's files if asked).
4. Not done / known gaps:
   - Root cause of LVGL dropping trailing "ศ" in Thai labels (glyph exists in font). Worked around: wording `ใช่/ไม่ใช่`, band labels use CLIP not DOTS. Any future text ending in ศ may hit it.
   - Scenario-change path only unit-tested (never changed scenario on the live LabVenture).
   - LabVenture dev has other undeployed diffs (algae_exporter.py, routes/algae.js, scenario_flood.json, app_settings.json) — not this work, left alone.
   - User decided: HOME keeps `--` when no lab result in the current sample window (same as web card); do NOT show stale values.

## 3. Non-obvious facts (gotchas)
- Off-site after START_FULLSCALE: Uroboros boots paused and runs 25 start tasks that each time out → engine offline for minutes (`GET :8888/admin/sequence/status`). Feed `engine_online:false` = expected, not a bug.
- After START check process count — one START at 13:02 produced 3× Uroboros/BellBeast that died; re-STOP/START fixed it.
- STOP/START scripts self-elevate (UAC prompt each). Deploy pattern: publish → diff vs `Fullscale_V2\*_proj` → copy only changed files with backup (see the `apply.ps1` in each bundle).
- Never test against the live :8888/:8889/:443 with writes. Local E2E = BellBeast exe with `--contentRoot iot\scratchpad\bb_e2e` on :5599 (Kestrel URL set in that folder's appsettings) + `iot\scratchpad\…\test_sim.py`-style injection into :5599 only. Run `bin\Debug\net9.0\BellBeast.exe` directly (bash `dotnet` is x86).
- `/api/device/lab/glance` HOME values come from Uroboros zone3 (≤6 sample slots back); group/unit pages from zone4 (last 6 points) — they differ by design.
- Scenario "rev" = LabVenture `GET /api/scenarios/log?limit=1` → `id` (new period on every scenario/threshold/epidemic change; `is_test` flag). Epidemic overlay keys: `GET /api/scenarios/epidemic/thresholds` (anonymous).
- Firmware: Thai font = `font_noto_sans_common_16_4.bin` in assets partition, loaded by `living_alarm.cc TryThaiFont()` from boot (theme loads it only after network). `CONFIG_LV_FONT_MONTSERRAT_20=y` added (sdkconfig + defaults) for the HOME table. Bump `PROJECT_VER` for every OTA build.
- Restore board to 1.1.1: `iot\deploy_0411\firmware\restore_ann-1.1.1.ps1`. Demo build sources (simulated data): `iot\scratchpad\demo_1.2.0_src\`. Pre-change source backups: `iot\scratchpad\bk_redesign_0411\`, `bk_pre_demo_0511\`, `bk_120\`.
- Read serial without resetting the chip: open COM9 with DTR/RTS low (script pattern in prior session scratchpad `serial_watch.py`).
- Admin login is the user's — never type it; ask them to sign in in the browser pane.

## 4. Suggested skills
- `scrutinize` or `code-review` — before the user commits, review this session's diffs (firmware `main/lab_glance.cc`, `living_alarm.cc`, `components/alarm_ui/*`; BellBeast `Services/LabGlanceService.cs`, `wwwroot/js/annunciator.js`, `MHxIotAlarm.js`; Uroboros `AlarmTestOverlay.cs`).
- `run` — to bring up the scratch BellBeast/:5599 harness when testing UI changes.
- `handoff:handoff` — at the end of the site session.
