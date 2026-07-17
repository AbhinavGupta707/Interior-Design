# C3 property dossier comprehension evaluation

## Purpose and boundary

This evaluation checks whether the C3 web experience communicates property identity, provenance, permissions and uncertainty without implying that an address establishes the present interior, legal boundary, structure, planning clearance or professional approval. It uses only deterministic synthetic fixtures and manual synthetic entries. It does not validate a live provider, a real property or human comprehension in production.

The frozen contract under evaluation is `c3-property-v1`. Owners and editors may resolve, select and refresh; viewers may read only. Model training is always denied. Estimates and inferences alone may display confidence.

## Automated assertions

The following assertions are executable in `apps/web/test/c3`, `tests/contract/property` and `tests/e2e/property`.

| Area                | Exact assertion                                                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty state         | A project with no source records renders search/manual entry for an owner and a read-only empty explanation for a viewer. It does not render a selected identity or dossier success state.                                                                      |
| Exact result        | The exact fixture search renders one candidate, its synthetic UPRN, dataset/version/licence/coverage and point caveat. Selection occurs only after the user activates **Use this property**.                                                                    |
| Ambiguity           | A two-candidate response renders two native radios with no initial choice. The submit action remains disabled until a candidate is chosen. Keyboard Space/Arrow navigation can make the choice.                                                                 |
| Expiry              | A server-declared expired resolution prevents selection, removes stale candidate authority and tells the user to search again or enter manually.                                                                                                                |
| No match            | `no-match` renders no candidate and no implied selection. Manual fallback remains available.                                                                                                                                                                    |
| Provider disabled   | `status: unavailable` plus `providerState: disabled` states that no live or fixture result was substituted.                                                                                                                                                     |
| Outage              | `status: unavailable` plus `providerState: unavailable` is described as a temporary adapter outage, separate from provider-disabled and browser-offline states.                                                                                                 |
| Offline             | A failed browser transport renders **You’re offline**, retains the form, makes no selection and recovers after the route is restored. The one deliberately aborted request is identified by the test; unexpected failed requests remain zero.                   |
| Manual fallback     | Manual selection accepts only the frozen address and jurisdiction fields. The resulting identity contains no UPRN or location and visibly says both are not supplied.                                                                                           |
| Revision conflict   | A stale refresh returns `REVISION_CONFLICT`, leaves the displayed dossier unchanged, requires **Reload current dossier**, and succeeds only after the current version is loaded.                                                                                |
| Non-disclosure      | A foreign/unknown project identifier renders the same **Project unavailable** message and does not expose tenant, project or property existence.                                                                                                                |
| Role behavior       | Owner controls are present. Viewer search, select, manual entry and refresh controls are absent while dossier and source inspection remain available.                                                                                                           |
| Epistemic labels    | The guide and items contain exactly `Source observation`, `User assertion`, `Estimate`, `Inference` and `Unknown`, each with a distinct explanation.                                                                                                            |
| Confidence          | Only the estimate and inference items render confidence (`70%` and `62%` in the deterministic fixture). Observation, assertion and unknown items render none.                                                                                                   |
| Unknown value       | Unknown items render **Not established**, have an explicit unknown contract value and do not invent a source.                                                                                                                                                   |
| Interior boundary   | The first dossier band says **Unknown until supported by explicit evidence** and states that address/context does not establish room layout, dimensions, wall thickness, structure or condition.                                                                |
| Planning boundary   | The summary says **Not reviewed · no clearance or approval claim**. Coverage copy says absence/no result is not clearance.                                                                                                                                      |
| Point/UPRN boundary | Copy states that UPRNs can share a point and that the point is not a legal boundary, footprint or interior geometry.                                                                                                                                            |
| Source inspection   | Each established item links to an included immutable source record. Source details expose provider, dataset/version, licence, coverage, retrieval time, fields and normalised SHA-256 without raw provider payload.                                             |
| Permissions         | Every source shows service processing, participant sharing and model training separately. Training displays **Denied**.                                                                                                                                         |
| BFF safety          | Browser-supplied role/tenant/provider fields and malformed identifiers are rejected before upstream fetch. Bearer authority comes only from the HTTP-only session cookie. Invalid upstream DTOs become a bounded 502 and raw provider fields are not reflected. |
| Semantics           | Each page has one `main`, one level-one heading, labelled forms/fieldsets, status/alert announcements, native details/summary disclosure and visible focus treatment.                                                                                           |
| Responsive layout   | Desktop 1440 × 960 and mobile 390 × 844 journeys assert `scrollWidth <= innerWidth`; primary actions stack at the mobile breakpoint without hidden content.                                                                                                     |
| Runtime health      | Successful journeys have zero unexpected console errors and zero unexpected failed requests. Typed 409/404 recovery probes and the single intentional offline abort are explicitly allow-listed and asserted by their resulting UI.                             |

## Moderated comprehension protocol

Automated text presence is necessary but cannot prove that a person understands the distinctions. A later moderated study should use at least five participants unfamiliar with the implementation and should not explain the labels before the tasks.

For each participant, show an exact synthetic dossier, an ambiguous result, a manual dossier and an outage state in counterbalanced order. Ask the participant to answer, in their own words:

1. What does the selected address prove about the rooms, wall thickness and structure?
2. Is the displayed point a legal boundary or building footprint?
3. Has planning been checked, and does missing context mean there are no constraints?
4. Which two items are calculations or interpretations rather than source/user statements?
5. Which fields remain unknown, and what evidence would be needed before relying on them?
6. Where did a chosen item come from, under which licence/version, and can it be used for model training?
7. In the ambiguous state, what must happen before a property is selected?
8. In the disabled, outage and offline states, did the system return a property result?
9. As a viewer, which actions are intentionally unavailable?

Pass criteria for a pilot comprehension round:

- every participant says the current interior and structure remain unknown without explicit evidence;
- at least 80% distinguish source observation, user assertion, estimate, inference and unknown without treating confidence as certainty;
- every participant says planning is not reviewed and absence of context is not clearance;
- every participant identifies model training as denied and does not merge it with service processing or participant sharing;
- every participant recognizes that ambiguity needs an explicit choice and that disabled/outage/offline did not select a property;
- no participant interprets the location point as a boundary or the synthetic dossier as professional approval.

Any failure on the interior, planning, boundary or training questions is a safety-language defect, not a cosmetic preference. Revise copy/hierarchy and repeat the study before pilot use.

## Residual limitations

- No moderated participant study has been run, so recall, scanning behavior, label interpretation and decision confidence remain unmeasured.
- Automated checks prove rendered words, semantics and control behavior, not whether users notice or remember the warnings.
- Synthetic UK fixtures avoid privacy and provider-rights risk but cannot reproduce the density, inconsistency, terminology or licence variation of approved live datasets.
- The evaluation covers Chromium at the checkpoint widths. It does not close Firefox, WebKit, screen-reader/browser combinations, zoom above 100%, cognitive accessibility or translated-copy risk.
- The deterministic confidence examples test placement and language, not calibration quality. No estimate or inference should be used as current interior truth.
- The BFF is tested against the deterministic mock. Integrated L1 persistence, expiry timing, idempotent replay, tenant isolation and correlated error behavior remain checkpoint integration evidence owned by the orchestrator.
- No real address, provider response, credential, paid/cloud service, customer data, physical-device capability or professional review is used or claimed.
