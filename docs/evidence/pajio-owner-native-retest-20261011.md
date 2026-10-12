# Owner iPhone, cloud devices and chat — 2026-10-11

This checkpoint supersedes the pending owner-device acceptance in
[the activation report](pajio-owner-activation-20261010.md). It establishes one
owner's working bundle; it does not establish external TestFlight availability,
multi-user capacity, or acceptance of every product feature.

## Physical-device acceptance

Pajio 0.2.0 (3) is installed on the owner's iPhone Air. The October 11 retest
used the real authenticated account on iOS 27.0.1 after the owner reconnected,
unlocked and authorized acceptance. Registration and onboarding were completed
by the owner; no password was entered by the acceptance operator.

| Path | Observed result |
| --- | --- |
| Linux computer | Native remote video, mouse input, Escape and explicit return passed. The relay reports `agent_ready`, gateway epoch 2, and both return confirmations. |
| Android cloud phone | Native video, swipe into the application drawer, open Clock, and the native Home action passed. The retest explicitly returned the device from its safe home screen. |
| Android return | The iPhone displayed `设备已确认交还，Pajio 可以继续操作。`. Both relay and device gateway report `agent_ready`, gateway epoch 4. The connector is connected and available; the private media host has **zero sessions**. |
| Real chat | A message sent from the iPhone requested only `OK`; the app displayed `OK`. The Core task record has that exact output, no error, a real run ID and usage. It completed in approximately 3.49 seconds. |

The actual submitted chat text was `REPLYONLYOK。\nDONOTUSETOOLSORSAVEMEMORY\n。`.
Device Hub's captured keyboard interacted with the phone's input method, so this
was not an exact-text or Chinese typing acceptance. The backend task retains
`completed_unverified`; the visual check verifies this reply only, and does not
rewrite the task state or claim autonomous tool execution was exercised. Usage
was 17,126 input and 2 output tokens, including 6,400 cache-read tokens. This is
one observed request, not a representative cost benchmark.

Private screenshots remain under
`.pajio/on-prem/20261009/native-personal-beta3-20261010/`:
`iphone-linux-touch.jpg`, `iphone-linux-returned.jpg`,
`iphone-android-retest-touch.jpg`, `iphone-android-retest-returned.jpg`,
and `iphone-live-chat-ok.jpg`. The phone was left on the chat page; both remote
devices were returned to the agent. Account/session data and screenshots are
not committed to the repository.

## Android return correction

The earlier live Android return timed out and left the device paused. A live
frame refresh can hold the same native lock needed to begin return. The adapter
now waits up to three seconds for **only** `device_action_inflight`, retaining the
original epoch throughout. A timeout, revocation or changed epoch still fails
closed. Media must clear before agent access is restored.

Real-lock regression tests cover a frame finishing during return, a persistent
lock timeout and a revocation during the wait. Private-media tests: 46 passed.
Device gateway/API/relay integration tests: 55 passed. This code-level race is
reproduced by tests; the original live exception was not recorded, so it is not
asserted as a conclusively traced cause of that earlier timeout. The deployed
correction passed the subsequent physical-phone return.

Only the owner's Android adapter was overlaid and its connector restarted;
the source and deployed SHA-256 are
`8238b09ef0075923f72e8afa341748e137f4f30d0732f0d0e82771e9d36956bc`.
The previous file and release receipts are retained privately for rollback.

## Live VM state correction

Provisioning previously depended on the asynchronously refreshed cluster VM
index. Inventory now reads each VM's live node status and rejects unknown states.
Regressions cover stale stopped/running index values and an unknown live state.
The focused transport, delivery, bootstrap, repair, activation pipeline and
worker suite passed 89 tests.

The control-host overlay SHA-256 is
`e746e73a9b4e938b924eca18082ba8bdaee5ae9856b4aaf2249a2398d5e06104`.
The owner activation was ready, complete, generation 44 and lease-free before
and after stopping the activation worker for the change. A release-harness
attempt to use a table lock was denied by the existing restricted database role
before any module/service mutation; no database grant was expanded. The final
release stopped the sole worker and re-read the unchanged activation before
replacing the module. Gateway and registration service PIDs were unchanged.

The host's exact-command allowlist was staged with the old and new versions of
the same capabilities, then finalized to six commands and the same two scopes.
Final canonical manifest SHA-256:
`a80651aee7365d10d97fa5cf9590ecd93c69c917a07b7ff03df2b9d3669d3702`.
A post-finalization inventory using the installed module and restricted worker
identity confirmed control, Core, Linux and Android all running. No VM start,
clone, ownership change or enrollment was replayed by this correction.

## Distribution and backups

Build 3 archive, export and upload succeeded. App Store Connect processed it,
displayed **Ready to Submit**, and associated it with `Pajio 个人内测`. The group
has no testers. The exported IPA is 38,422,895 bytes, SHA-256
`10bddc1e58a4de484ccd4c9bcf7811a4fd3e011507464c58ed44502784702e9a`.
Private proof: `testflight-build3-group.jpg` and the distribution receipts in
the native build directory. No external review submission or approval occurred.

The verified operations scope now covers control, Core, Linux and Android.
The first Linux and Android backups completed; both passed `zstd -t`, root-owned
0600 archive checks and SHA-256 verification:

- Linux: 2,254,754,970 bytes,
  `d11d29bf613e79897a448afcdf08f23a01b6d4b901ca868aa25fac0ffa02fcf6`.
- Android: 5,322,009,906 bytes,
  `709ecdc80b1de5302d5db72cff5bff72a42a1e01b1ae2df9aa4600979c5581fe`.

These are local backup and integrity results. Offsite recovery, a restore drill
and 48 hours of continuous health are not established.

## Remaining release gates

- An isolated reviewer login and external TestFlight review are still required.
- Additional complete bundles have not passed the no-oversubscription capacity
  gate. Do not issue extra invitations on the basis of this single-owner pass.
- Cold first activation remains too slow; prepared identity-clean images/cache
  and measured repeat provisioning are needed before a broader invitation batch.
- Remote Android still displays UTC. Localization/timezone, voice-provider
  availability, push delivery and the full account-deletion lifecycle remain
  separate acceptance items.
