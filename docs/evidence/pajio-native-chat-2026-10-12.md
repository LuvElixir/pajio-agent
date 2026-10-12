# Pajio native conversation delivery

## Implementation

The iOS/Android conversation now renders with React Native `FlatList`, `Text`
and `TextInput`. There is no WebView in the native chat renderer. Web retains
its platform-specific implementation. This change preserves native voice,
share intake, account-scoped drafts, task details, files and pending approvals.

- The inverted list pages 40 messages at a time. Visible content is anchored
  while reading older replies; following new output is limited to the bottom.
  A return-to-latest control is available when the reader moves away.
- Incremental requests retrieve new messages and watched tasks. Unchanged row
  objects retain their references. Output-only changes do not sort old history.
- Multiline input grows to a bounded height. The App owns one keyboard avoidance
  layer, with interactive drag dismissal and the tab bar hidden while typing.
  Sending does not replace or blur the native text field.
- A bounded recent-history cache is available before the network returns. A
  serialized draft journal persists before submission and retains the same
  request ID after an ambiguous normal send. There is no automatic POST retry.
  Record-context submissions retain the existing API's non-idempotent limitation
  and block ambiguous resubmission instead of inventing a delivery receipt.
- Text supports native selection, links and bold spans. Replies over 6,000
  characters offer a native full-reader sheet. This is not a full HTML/Markdown
  renderer; complex tables and code remain selectable text.

The server adds optional keyset pagination to `/api/conversation`. Existing
clients without `limit` retain the original array response. Ownership is checked
before pagination; hydration of tasks, artifacts and confirmations is bounded
to selected rows. Foreign-owner cursors and watch IDs cannot expose history.

## Verification

- 61 server tests passed across pagination, owner boundaries, handoff, activity
  review, confirmations and artifacts. A 105-row history with tied timestamps
  pages without gaps or duplicates; incremental catch-up and watched older tasks
  are covered. A separate assertion limits task hydration to selected rows.
- 46 mobile tests passed across native history, draft backup, task details,
  conversation state and account-cleanup fences. The 10,000-row merge test checks
  ordering and stable references; it is not a 10,000-row device rendering benchmark.
- TypeScript and direct source ESLint passed. The direct ESLint entrypoint avoids
  the existing local Expo/npm launcher issue.
- Scoped Core deployment compared live file hashes and retained a rollback
  backup before restarting `pajio-tenant`. Public authenticated history reads
  returned HTTP 200 in 110–176 ms for the real account's four existing messages.
  Those are route measurements from the control server, not iPhone render times.

Private receipts, source hashes, test logs and screenshots are retained under
`.pajio/qa/20261012-native-chat/`, excluded from version control.

## Device acceptance

Release 0.2.0 (9), signed with the existing development team, was installed over
the existing Pajio application on Luvloving (iPhone Air, iOS 27.0.1). No uninstall
or data reset was used. `codesign --verify --deep --strict` passed. The installed
candidate's JS bundle SHA-256 is
`a8390054badf1f4df9682db883368a291539ca9f11bd5223fad2fe766cec788d`.

Observed through Device Hub on the physical iPhone with candidate 2 (JS hash
`869fd3b9b23f9d2ae22b7ec4046e1b11b508d2a5c43b92ead3675147c6ed62e2`):

- Existing account and history survived both overwrite installations and cold
  relaunches. No login or AI consent page reappeared in these checks.
- A three-line draft expanded the input field and remained fully visible.
  The same text survived process termination and relaunch, and text/voice mode
  switching. The synthetic draft was cleared after this check.
- With the iPhone software keyboard visible, the composer followed its top edge
  without an overlapping tab bar. Dragging history dismissed the keyboard and
  restored navigation while retaining the draft.
- Scrolling back through the existing long conversation exposed the return-to-
  latest button. After scroll inertia settled, subsequent background reads
  retained the visible position. The button returned to the latest reply.
- A single native send of `Reply OK` produced a user bubble and the real reply
  `OK`; the composer cleared after acknowledgment. This benign test exchange is
  left in the account's conversation as the delivery receipt.
- Long-pressing the reply displayed the iOS Copy menu. Completed messages showed
  their time instead of the erroneous unknown-status label found during QA.

Final code review then scoped remote-input approval locks to each approval ID
and revision, so a submitted decision cannot disable unrelated pending rows.
This was the only source change in the final candidate. TypeScript and full
source ESLint passed again; signing, overwrite installation and launch succeeded.
The Mac locked before the final visual recheck, so this last approval-lock change
has source/build verification but no new physical-device approval-flow acceptance.
The chat renderer, composer and scroll implementation are unchanged from the
candidate whose physical-device checks are listed above.

Device Hub's captured hardware keyboard suppresses the phone's software keyboard
and routes Latin typing through the phone's Chinese IME. Software-keyboard checks
were therefore performed with keyboard capture released. This is a limitation
of the inspection setup, not evidence of a measured input-latency regression.

## Native design audit

The scoped Impeccable native audit covered input growth, keyboard avoidance,
scroll continuity, text selection, message contrast, task controls and reduced-
motion handling. The first installed candidate exposed clipped multiline input
and an empty completed-status label incorrectly falling back to unknown; both
were corrected, rebuilt and checked on the final installed candidate. Native
chat uses the current theme colors and system typography; an unregistered Menlo
font override was removed. The derived design sidecar was refreshed without
changing the project's normative design tokens.

Touch actions have at least 44-point targets, semantic button roles and named
icon actions; reduced-motion handling and font scaling are present in source.
VoiceOver traversal and extreme Dynamic Type sizes have not been accepted on
this device. Android device acceptance, frame-time profiling, adverse-network
and long-duration tests remain separate. The 10,000-row automated merge check
does not establish a 10,000-row physical-device scroll benchmark.

This delivery replaces the native conversation renderer, not every surface in
the application. External artifacts and remote-computer views retain their
existing rendering paths. Full rich Markdown tables/code formatting is outside
this change. An existing briefing request stores verbose source-snapshot JSON
in its message content; history still exposes that stored text, as the previous
web chat did. A concise display representation for those automated requests is
a separate follow-up.
