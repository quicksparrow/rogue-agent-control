# Rogue Agent Control interface

Product authority: `PRODUCT_BRIEF.md`. The Black Box remains the main workspace. A newcomer can select a recording, find a deviation and inspect evidence without mistaking a fixture for a live purchase.

## Visual system

`src/app/tokens.css` owns the palette, type scale and spacing. Navy `#152A43` anchors the navigation, blue `#326DA5` identifies primary actions and selection, and light `#F7F9FC` with white surfaces keeps dense evidence readable. ALLOW, DENY and REVIEW retain distinct semantic colors. Geist is the interface face; Geist Mono is reserved for IDs, timestamps and JSON. The type scale runs from compact evidence labels to a restrained page title. Spacing uses 4px steps and a 6px corner radius. The Geist license notice is in `docs/Geist-OFL.txt`.

## Workspace behavior

The grouped navigation identifies the current page and collapses to a named menu on narrow screens. A shared heading, actions, status band and content width connect Black Box, Shopping Agent, Policy Firewall, Sandbox Checkout, Investigation, Replay and Explore Demo. Primary actions are visually distinct from secondary and text actions. Focus rings, disabled states, pending feedback and error recovery are consistent.

Black Box pairs a timeline or AG Grid Community explorer with an evidence inspector. Selecting an event synchronizes the row and persisted JSON; citation links select the exact referenced event. Investigation separates deterministic observations from model interpretation and gaps. Replay labels both policies, changed rules and hypothetical decisions while making the lack of execution authority explicit. Synthetic fixtures and genuine archived evidence remain visibly distinguished.

Desktop keeps dense evidence panes side by side when space allows. Tablet and mobile stack sections, keep forms and controls reachable, and permit local grid scrolling without page overflow. Dialogs restore focus after dismissal. Reduced-motion preferences suppress nonessential transitions. The interface does not imply that synthetic results, an AI narrative or a replay decision authorize a financial action.
