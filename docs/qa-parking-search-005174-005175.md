# BUG-005174 / BUG-005175: nearby parking search and empty states

Draft repair stacked on PR #186. No hosted database changes, extra private data requests, live payment work, or active QA/production deployment.

## Defect and behavior

Previously, selecting a Google destination bypassed text filtering and sorted the entire discovery feed by distance. There was no distance cutoff. Public approximate listings also bypassed all text filtering, even with My location enabled. Empty filtered lists had no message in the list panel. Walking estimates could consequently describe parking hundreds of kilometres away.

The proposal uses a **5 km straight-line radius**, measured from the selected destination or device location to permitted listing coordinates. Both map and list receive the same eligible results, across price/rating/distance sorting. Listings missing usable coordinates cannot qualify for a nearby search. Plain browse without a location retains its overview.

The radius is a documented default for QA/product review, not a guarantee of a particular walking time. It is displayed above anchored results and in the empty state. Public coordinates are rounded to 0.01 degrees by the existing discovery contract; distances and inclusion at the boundary are approximate. No exact coordinates, private address, private title, or Host identity are requested to improve public matching.

Typing filters only the safe title/address already in the discovery DTO. Public DTOs currently contain generic labels; a named place such as a mall or city must be chosen from Google autocomplete to resolve a destination. The local fallback does not search hidden addresses. My location stays active while typing; editing a previously selected destination clears that obsolete destination anchor. The My location button can switch from a chosen destination to the actual device location.

Empty results show a **No parking nearby** or **No parking matches your search** message with a **Clear search** button in List, Map and Split views. Global loading/network errors remain separate from an actual empty search. Clearing removes text, destination/device anchor, discovery context, suggestions and stale pin selection.

Autocomplete, Place details and geolocation callbacks share request-generation checks. New input, clearing, switching location and unmount invalidate old callbacks. Routes are keyed to their destination and permitted candidate coordinates, preventing reuse of stale walking times.

Walking matrices are requested only for nearby eligible listings with permitted precise coordinates. Coarse public locations retain an explicit approximate-area, straight-line estimate, not a claim of an exact pedestrian route. Google routes are labelled as route metrics when available; explicit no-route or malformed metrics show **Walking route unavailable** instead of inventing a successful walk. Routing service failure can still use the labelled straight-line estimate. The toolbar explains that such estimates can underestimate the actual walk.

## Verification

- 37 new focused calculation and actual BrowseView JSX interaction/render cases. The component harness executes the source JSX with controlled hooks, synthetic Places/geolocation/routing responses, and stubbed child maps; it is not a live browser or Google API test.
- Nine selected source-component regressions fail on the unpatched PR #186 version with assertion failures, then pass on this repair.
- Covers radius boundary, far/missing/invalid coordinates, antimeridian math, all view modes, active My location plus unmatched text, clearing, destination changes, sorting, private/coarse coordinate distinction, delayed autocomplete/Place/geolocation/routing, route failures and loading/error states.
- Full local regression suite and application build pass; native PostgreSQL and preview results are recorded in the PR.

## BetterQA acceptance after coordinated deployment

1. Choose a Toronto-area destination with nearby test listings and one with no coverage (for example a remote city). Confirm only nearby parking appears and an empty search keeps the destination map anchor without distant pins.
2. Repeat in List, Map and Split at desktop and mobile sizes. Confirm messages and Clear search are visible, readable and operable. This PR does not address the separate list-width and pin-centering tickets.
3. Activate My location, type an unmatched string, clear it, and choose a destination. Check both panes, location button state and consistent results under all sorts. Test denied geolocation and destination-provider errors.
4. Use slow responses while changing/clearing searches. Older suggestions, positions and walking times must never restore an obsolete selection.
5. Confirm public results expose only approximate locations and clearly labelled approximate walking estimates. Validate real Places/Routes configuration and any entitled precise-location flow on QA.
6. Check the 5 km default and approximate-coordinate boundary behavior with product expectations. The existing public discovery feed is limited to 200 newest listings; this frontend repair does not add server-side geographic pagination or guarantee exhaustive coverage beyond that feed. Larger-catalog geographic coverage remains a separate acceptance/scaling concern.

Keep both tickets open until coordinated deployment and BetterQA browser verification. No real Google API calls, device-location permission prompt, hosted SQL, active alias promotion or customer data changes were performed in preparation.
