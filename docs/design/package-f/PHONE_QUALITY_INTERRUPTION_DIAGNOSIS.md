# Phone quality interruptions — 2026-10-12

## Result

The two Chromium failures were interrupted by a Vite full-page reload, not a proven Modal/business defect or Windows sleep/crash. Codex changed ACTIVE_TASK.json during the browser run to record the newly approved checkout scope. Freezing only product source was insufficient:Tailwind scans the task document and its Vite hotUpdate sends full-reload for this watched JSON asset. Do not write ANY watched checkout file (including checkpoints/docs) while a browser gate/server is active;logs/telemetry live outside the checkout. No product/test/timeout/retry repair is needed for these interruptions.

The original run remains exit1 (743PASS/59known conditional skips/2FAIL),never an aggregate quality PASS. Owner's environment-stop exception permits delivery after the isolated repeats and exact Linux CI;all pre-browser gates passed. No full local rerun or CI change is introduced.

## Windows and memory

System logs for the previous8hours contain no Kernel-Power42/107/506/507,Power-Troubleshooter1 or Resource-Exhaustion events. The Resource-Exhaustion Operational log also has none;Application1000/1001/1002 has no event around07:25–07:28Amman. These negative log results do not rule out memory pressure. At08:02Amman:battery100%,PowerOnline=true,not discharging;free1.715GiB/total15.730GiB. Historical free RAM/battery at the original failure was not sampled and is not invented.

Fresh runs sampled every10s:counts below are MACHINE-WIDE node.exe/chrome.exe,not just owned children;node_repl6 throughout,WebKit0. Memory fell as low as0.162GiB yet the purchasing case passed10/10;pressure is a real risk,not the evidenced trigger of this incident.

| Chromium case | Tree | Result | Wall seconds incl. setup/teardown | Free GiB min–max | Node count | Chrome count |
| --- | --- | --- | --- | --- | --- | --- |
| Products dark1440 | current6189a57+phone3/4 | 10/10 | 140.820 | 0.344–2.659 | 11–19 | 18–20 |
| Purchasing forms light | current | 10/10 | 169.766 | 0.162–3.183 | 12–22 | 14–25 |
| Products dark1440 | clean289f398 | 10/10 | 139.658 | 1.228–3.567 | 11–19 | 14–15 |
| Purchasing forms light | clean289f398 | 10/10 | 145.183 | 0.378–3.258 | 13–21 | 14–16 |

All four valid runs used the original unmodified cases,desktop-chromium,repeat-each10,workers2,retries0,original timeouts/config,one run at a time. Baseline used a detached worktree with its own npm-ci dependencies;package-lock SHA256 matches current3EF2EE82E8324A85D4931A1B188ED3E5F5AA79219FE4498A230B6A234A8965C0. Baseline tracked tree remained clean. An earlier dependency-junction setup gave font403 responses;its10passes are EXCLUDED from the40 valid results. No assertion was changed or retried to hide a failure.

## Original trace and controlled proof

Products:original document07:26:05.869Amman;Form nav click07:26:10.879(converted from library trace clock);fresh SAME document request07:26:11.588(status200),without another test goto. Before that reload the panel was opening;after it the harness returned to its default catalogue without the form. The trace does not instrument onAnimationComplete,so no claim that the callback itself is defective is made. Reload destroys the React instance/DOM before the stable-dialog assertion can succeed.

Purchasing:receive document07:26:10.540;axe injection starts07:26:11.525;runPartial capability evaluate07:26:11.665;uncommanded SAME document request07:26:11.651(status200),63ms after Products' reload. The old execution context is destroyed,reported07:26:16.285(converted from library trace clock). No trace crash event,failed resource status or recorded test-triggered navigation precedes it;the original server did not retain the websocket trigger,so the file attribution also uses the recorded checkpoint timing and controlled reproduction.

Controlled proof08:22:39Amman:open product form and purchasing receive page on the same isolated server;touch only ACTIVE_TASK.json mtime,content SHA256 remains c8107b9a96c46869244c5ebdca54e0794bad6b433a75ab7e087158862c161421. Server emits `page reload docs/agent/ACTIVE_TASK.json` then websocket `full-reload`;both main frames reload within18ms of each other,Products dialog count becomes0,receive dialog remounts as1. No crash event. Original document mtime restored,content unchanged;all owned probe/test servers stopped. The initial standalone probe timed out on its30s load setup and is not counted;the valid probe uses domcontentloaded plus actual workbench/dialog readiness,not a timeout increase or test change.

## Reachable phone files

- Products/Form/Detail/StockAdjustment/ParcelConfiguration/Modal/hooks/dialogFocus and both original failing specs/harnesses are byte-identical to289f398. No phone action-sheet/tab is rendered in the Products Form or receiving form under test.
- src/components/ui/index.ts indirectly loads new PhonePresentation definitions through existing UiButton/FormFields imports;definitions alone do not register dialog guards. src/index.css imports phone-presentation.css,whose rules target only `.nw-mobile-actions` and44px rare-action sheet buttons,not these forms.
- PurchasesView and DirectReceivingView have approved phone presentation changes and are statically imported by the purchasing harness;failed view=receive renders ReceiveGoodsModal directly,not either list. The list changes do not explain a main-document reload. Settings/CRM/Expenses/Users changes do not run in these failed form views.
- ACTIVE_TASK.json is not a product import;it is a Tailwind scan/watch dependency. Its mid-run edit was the operational error and is not repeated during these four valid runs.

Evidence outside checkout:C:/Users/TOP/AppData/Local/Temp/nawasrah-phone-diag-20261012/:four *-local/current logs,exit JSON,10s memory JSONL,traces;document-watch-evidence-*.json contains the successful controlled server/browser chronology. Original two trace/video/error-context folders remain in test-results. No Production/deploy/form/state/RPC/payload/migration change.
