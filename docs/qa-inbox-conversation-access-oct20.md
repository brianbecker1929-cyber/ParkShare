# Messages inbox conversation access — 20 October 2026

## Confirmed defect and repair

Code-identified defect; no assigned BetterQA issue number. MessagesView rendered conversation cards as clickable divs without native focus or keyboard activation. Keyboard users could not tab to and open a conversation. Each row also used only its listing ID as its React key, even though api/messages.js distinguishes conversations by listing, booking and participant. Multiple Drivers or repeated bookings on one driveway therefore produced duplicate sibling keys.

Render each card as a native type=button control. Use valid span content, with visible name/listing/message-preview text providing its accessible name and decorative avatar/chevron hidden from assistive technology. Native Tab focus and Enter/Space activation use the existing click callback; no duplicate synthetic key handler is added. Keep the browser focus outline, existing card styling/hover behavior and explicit full width/left alignment/inherited font.

Use the existing immutable messageConversationKey(account, listing/booking/participant) helper for each row. Keys remain stable when display text or row order changes, and distinguish different Drivers, repeat bookings, listing-only threads and accounts. Keep the row's id as db-{listingId} so opening the selected conversation still receives the original listing/booking/participant context. React key guidance checked against https://react.dev/learn/rendering-lists .

Scope: inbox row accessibility and React identity. No API, backend authorization, query, schema/grant, credential, dependency, message-send/confirmation, email-template, payment or other auth-flow changes. This does not claim a backend message merge or recipient-authorization defect; existing server participant checks and RLS remain authoritative. Opening a conversation still does not send a message.

## Verification

`test/qa-inbox-conversation-access.test.js` compiles the actual MessagesView, loads synthetic API conversations through its actual state/effect mapping, checks returned React elements and renders static HTML with ReactDOMServer. Four new checks cover native controls/visible accessible names/valid button content, unique Host rows on one driveway with exact selected context, stable keys across reordered/edited API records, and Driver listing-only/booked threads with account-scoped identity. Previous actual App fails all four checks. Existing messaging/controller/API tests remain applicable.

Focused validation: 59 messaging checks pass. Run full local tests/build/diff checks, then native CI and the captured PostgreSQL schema rehearsal on the exact candidate tree before QA-only deployment. Verify stable alias, deployed SHA/readiness, served JS and public/access HTTP checks; record final evidence in the PR. Synthetic API/session data only. No real login, message, account/session, mail, payment or database mutation is performed.

Static/native-control tests do not exercise a browser's actual focus, keyboard event dispatch, screen reader or visual layout. BetterQA must confirm those with approved QA accounts. Default browser focus indication is retained; no new custom focus CSS is introduced.

## BetterQA acceptance

1. With approved Host and Driver QA accounts, open Messages and use only Tab/Shift+Tab to reach each conversation. Confirm visible focus and a meaningful announced name containing the other party, listing and preview.
2. Activate a focused row with Enter and Space. Each action should open the selected conversation with the correct booking/participant; opening must not send a message or submit a surrounding form. Retest mouse/touch activation.
3. As Host, test several Drivers messaging about one driveway and repeated bookings by the same Driver. As Driver, test listing-only and booked conversations with the same Host. Each row must open its own thread; check the console for duplicate-key warnings.
4. Check updated previews and reordered conversation records, desktop/mobile card alignment and keyboard focus indication. Verify normal account changes, message-email links and previous send-confirmation/draft handling still work.
