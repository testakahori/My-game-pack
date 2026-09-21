# UI / OBS画像エディター QA — v1.0.36

Result: passed for the implemented desktop UI and exported PNG workflow. OBS itself has not been operated in this QA. Native installed-app smoke results are recorded separately in the local handoff.

## Scope and reference

User-provided portrait streaming reference: codex-clipboard-f6d2cad6-0441-4c74-839b-fd5a1e89dc0a.png. The upper gift panel is the comparison target: yellow two-line heading, compact six-column dark cards, large gift icons, high-contrast labels and thin colored frames. The gameplay and third-party content are not reproduced. Actual catalog gifts differ intentionally. The white-card template supports a separate bottom panel.

Local evidence: C:/Users/MAKI/AppData/Local/mygamepack-ui-qa-20260921/. The reference crop and exported PNG were normalized to 410 px width and opened together in 19-reference-comparison.png. This verifies the intended composition, not pixel identity. No claim of full accessibility compliance is made.

## Verified behavior

- Three templates preserve selected gifts and edited labels; rows grow when cards are added.
- Actual gift images load through the existing app image API. Failure and timeout stop export and offer retry.
- Group and individual colors, border/background modes, automatic contrasting label color, custom labels and repeat counts.
- Ordering, undo/redo, saved-design switching and persisted edits after page reload.
- Overflow blocks export; fit-to-cards resolves it without dropping cards.
- Actual browser PNG exports: 1080 × 680 headline/grid and 1080 × 460 white cards. Alpha-channel checks confirmed transparent margins and opaque cards. Selection handles are excluded.
- Vertical/horizontal placement preview is clearly labeled; scene placeholders are excluded from PNG.
- Desktop at 1280 × 720 and 1024 × 768 CSS viewport; no document horizontal overflow at 1024. Longer settings areas scroll.
- Navigation smoke: gifts, event rules, roulette, voice, statistics, initial setup, operations tabs and image editor. No real Minecraft/TikTok side effects were invoked.
- Console contained no warning/error at the final browser check.
- npm run verify: TypeScript, 14 bridge simulations, 62 app tests and production build passed on 2026-09-21. Browserslist data-age notice only.

## Visual review

Typography: Japanese headings and controls have consistent hierarchy; effect labels shrink/wrap within each card. Long labels should be shortened for small OBS display sizes.
Layout: grouped sidebar, image editor as a direct destination, left-side controls and main preview, grouped operations settings, secondary launch/log controls folded away.
Colors: charcoal surfaces, mint navigation, purple creator actions. Gift category colors are editable; image labels select dark/light contrast automatically unless overridden.
Imagery: real catalog images maintain aspect ratio. No fabricated gift illustrations or gameplay placeholders enter the PNG.
Copy: action-oriented Japanese labels, OBS placement instructions and explicit save/loading/error feedback. Technical config filenames removed from event-page introductory text.

## Issues corrected during QA

- Launch steps wrapped into a narrow column: explicit two-column step layout.
- Card controls were below the preview: moved into the left Card tab.
- Heading was too small relative to the reference: default headline size increased.
- Noisy duplicate status and decorative monitor activity: status centralized; operations activity now reports actual event history.
- Preview image requests initially failed TLS validation in the local dev process: configured the existing trusted CA file for that process; verification remains enabled.

## Evidence index

07-dashboard-fixed.png, 08-color-cards.png, 11-light-template.png, 12-editor-1024.png, 14-gift-settings.png, 15-event-settings.png, 16-roulette-settings.png, 17-tts.png, 18-stats.png, 19-reference-comparison.png, 20-setup.png, 21-final-editor.png, 22-final-vertical.png, 23-final-operations.png, png-validation.json. Earlier screenshots precede small final styling/copy adjustments; final editor and operations captures show v1.0.36.

## Native follow-up — v1.0.37

The installed v1.0.36 app exposed an OS-specific image download failure missed by the dev process: Node fetch returned UNABLE_TO_VERIFY_LEAF_SIGNATURE while the catalog images displayed via Chromium. The image API now uses Electron net.fetch, retaining HTTPS-only redirects, MIME validation, a 10 MB streamed limit and timeout. A real catalog URL succeeded with the new transport and failed with the old one in the same Electron runtime. Six additional regression tests passed (82 total); native PNG save is rechecked after installation. The app icon is now included in the packaged files.


## v1.0.38: gift commands inside the image editor

- Registered gifts and selected preview cards now open the same focused command dialog. New assignments can also be added from the complete catalog.
- Browser QA: command-only save retains custom caption and purple color; explicit image sync updates title/repeat; image undo retains the saved game command; reopening and the main gift settings page show the saved command/repeat. Invalid repeat 101 disables save. No browser console errors.
- Native save IPC has regression coverage for preserving unrelated settings, stale edits, duplicate registrations, missing commands, invalid repeats, and failed validation. Existing backup and atomic write paths are reused.
- React review: parallel independent reads, canceled-load guard, explicit async save, disabled pending actions, modal focus containment, accessible labels, and existing unsaved-change protection.
- Screenshots and actual installed-app verification are recorded in the local handoff, outside the public repository.

## v1.0.39 — Gift templates and card removal

- Typecheck, production build and 99 automated checks (14 Bridge + 85 app) passed. CI passed on Windows/Linux and for the Mod build.
- Browser and installed app: individual top-right × removes only that card; undo restores it; saved gift commands remain unchanged. Native design went from 8 to 7 to 8 cards.
- Native save exported all 5 existing gift assignments with only gift ID/name/command filename/repeat. No account or connection data was exported.
- Native open preview left settings untouched. Apply changed 5 rows to the 2-row test set, including heal.txt ×2. Loading the exported original JSON restored the complete original config.
- A template with a missing command disabled Apply and displayed the missing filename. Cancel kept the original config.
- Native PNG export: 1080×420, 162497 bytes, all 8 images visible, no × controls in output. Evidence: local QA files 31–33 and v139-native-qa.json.
- Limitation: the first native save-dialog invocation after installing exited with Windows code 0xc0000409. The cause is not established. After restarting, five native save/open operations (including PNG export) completed without recurrence; this is not claimed fixed, and Norton is not established as the cause.


## v1.0.40: MAP saves and automatic stream records (2026-09-21)

- Image editor no longer exposes command-edit controls; charcoal gold cards and Night Stage 6×2; gift save/load wording simplified.
- Named MAP snapshots include inventory and dimensions; verify SHA256 before swap, automatically retain pre-load world, recover interrupted swaps, reject active external server and concurrent path/start operations. No PowerShell in the new MAP save/load path.
- Record TikTok room IDs and observed connection intervals automatically; same-room reconnects stay together, zero-event broadcasts retained, stale heartbeat stops crash duration growth. Explicitly distinguish command counts from actual TikTok gift/like/coin totals.
- Native isolated Electron fixture: named save → modify world and player data → UI load → original data restored and modified world present in automatic safety save. User's actual world untouched during this test.
- Native save dialog wrote 3374-byte UTF-8 Markdown with two simulated broadcasts (1200/600 observed seconds), room IDs and escaped Japanese names. No real TikTok LIVE end-to-end test was performed while offline.
- Native image preview loaded Heart Me image against charcoal background; card inspector contained image text, repeat, group and color only.
- Validation: TypeScript, 14 Bridge scenarios, 100 app tests and production Vite build passed.
- Previous v1.0.39 one-time native save-dialog 0xc0000409 crash remains unexplained; it did not reproduce in this task's Markdown save flow.
