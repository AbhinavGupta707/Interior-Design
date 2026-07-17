# C8-L4 evidence record — 2026-07-17

## Evidence summary

| Surface                             | State                                              | Evidence class                                         |
| ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| Nerfstudio/gsplat adapter contracts | executed with injected fixed executors             | visibly synthetic fixture                              |
| Subprocess output-limit boundary    | executed with a real local child process           | boundary-only; no neural tool                          |
| Independent evaluation/security     | executed locally                                   | synthetic reference/static                             |
| Browser presentation                | executed in local Chromium at 1440×960 and 390×844 | visibly synthetic fixture                              |
| In-app Browser plugin               | initialization failed before tab acquisition       | `NOT RUN` through plugin; CLI Playwright fallback used |
| Integrated web BFF/API/worker       | producer lanes not merged in this worktree         | `NOT RUN`                                              |
| C8-L2 native fixture XCUITest       | producer identifiers not merged                    | `NOT RUN` by explicit skip contract                    |
| Physical iOS camera/RGB-D           | no eligible device evidence                        | `NOT RUN`                                              |
| Nerfstudio 1.1.5 / gsplat 1.4.0     | absent on this Apple Silicon host                  | `NOT RUN`                                              |
| NVIDIA/CUDA/Windows workstation     | unavailable on this host                           | `NOT RUN`                                              |
| Paid/cloud provider                 | neither required nor invoked                       | `NOT RUN`                                              |

All repository fixtures are visibly synthetic and rights-cleared. Service processing is explicit; training use is denied. No customer media, source payload, object key, signed URL, secret, or live provider data was used.

## Browser observation

The local fixture passed six Chromium journeys: owner completion with geometry/appearance separation; partial/disconnected/unknown-scale/error/offline state coverage; viewer read-only behavior; cancellation and fenced replacement; 390×844 responsive layout without horizontal overflow; and keyboard-only consent/start with focused result status. The first run exposed and then fixed a focus defect: the status container was focused instead of the changed heading.

Page title and visible copy identified the surface as `C8 synthetic reconstruction acceptance` and `Visibly synthetic`. Content Security Policy denies external connections and assets. The test observed no unexpected console error, page error, failed request, disclosure marker, or horizontal overflow.

The in-app Browser capability was attempted first as required, but its runtime failed during initialization with a process-global setup conflict before a tab could be acquired. The explicitly required Playwright E2E suite was used as the local fallback. This does not affect product runtime, but it remains a limitation of the in-app evidence route for this run.

## Open evidence

- Run the live web journey only after L1/L2/L3 composition and record real API/storage/worker state.
- Generate the Xcode project after the C8-L2 fixture producer is merged, then run the five C8 XCUITest journeys on Simulator.
- Compile the physical-iOS branch and perform named-device camera/depth/interruption/accessibility checks; Simulator cannot substitute.
- Run `run-acceptance.ps1` on the pinned Windows 11/NVIDIA workstation and complete the hash/resource/output evidence.
- Add licensed/public-domain holdout observations with independent truth before reporting geometric error; no representative or survey-grade accuracy claim is currently supported.
