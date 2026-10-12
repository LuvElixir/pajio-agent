# Pajio iPhone session and response-time repair

## Delivered

iPhone Release build 8 was installed over the existing App, without uninstalling
or clearing account/local data. Gateway and Agent Core changes are deployed.

- Existing-account sign-in now uses native username/password fields. The fixed
  first-party gateway verifies with Keycloak; credentials never enter Agent Core.
  Active invitation membership is still mandatory. New device sessions last 30
  days; existing 8-hour sessions retain their original expiry until the next login.
  Web sessions retain the existing policy. OTP-required accounts fail closed;
  the current native form does not yet offer an OTP field.
- AI consent remains server-authoritative. A scoped local receipt only preserves
  the screen while reconnecting; it does not authorize dispatch. Backgrounding
  invalidates the live execution gate but no longer destroys the chat screen.
  Failed status reads show connection failure, not an ambiguous consent submission.
- Cancelled upstream responses now release HTTPX connections even when cancelled
  before body iteration or during streaming. Cleanup is shielded from the
  cancelled ASGI task scope.
- Chat history loads before auxiliary status requests. Unchanged message nodes
  survive updates, preserving media/selection and avoiding full-history redraw.
  User and assistant messages have distinct, readable day/night surfaces.
- A native login abandoned by leaving its screen cannot silently replace the
  locally restored account. The existing transactional credential-save guard
  also checks that the submitting screen is still active.

## Evidence

The previous authenticated consent/history/status requests exceeded a 25-second
probe timeout. The gateway had accumulated unreleased upstream connections.
After repair, authenticated probes from the control server through the public
entry returned: session 116 ms, consent 77 ms, bootstrap 70 ms, history 117 ms,
status 73 ms, mobile CSS 94 ms, all HTTP 200. These are server-origin route
measurements, **not measured iPhone tap-to-render latency**.

Sixty interrupted-stream probes followed by ten normal requests left the latter
successful at roughly 42–46 ms. Native login was tested with a disposable identity:
uninvited access rejected, invited login completed in 443 ms, authenticated session
worked, revocation took effect immediately, and that disposable identity was removed.
No real user's password was used for this API test.

On the connected physical iPhone, the account survived overwrite installation and
force-relaunch. Chat returned with history; switching to Today and back retained
the conversation. Background/foreground did not demand consent again. The
existing-account form opened inside the App, input text was vertically centered,
and returning from that form preserved the original account. Night-mode bubbles
were visibly distinct. The user's password was not entered or submitted by the agent.

Automated verification: 64 relevant mobile tests passed; TypeScript and source
ESLint passed. The gateway regression rerun passed 37 tests after correcting an
old CSP expectation; the other 78 cases in the preceding selected server run
passed. The 26 selected chat/draft/submission tests passed. Cancellation guards
were checked again after the final native login lifecycle adjustment.

The project-wide `expo lint` launcher encountered the local npm/npx ESM issue.
Direct ESLint over `src` passed; generated exports and unrelated existing plugin
lint errors are not claimed as resolved.

Private build, deployment, performance and device receipts are retained under
`.pajio/qa/20261012-session-experience/`, excluded from version control. Deployed
files were compared to live baselines and backed up before replacement. The
Keycloak provider has no maintenance HTTP endpoint and is inert after its
one-shot activation environment is removed.

## Remaining experience work

The chat content renderer still uses WebView; this repair does not claim a full
native chat implementation. The next substantial improvement is a native,
virtualized message list with incremental reply updates, native selection and
copy actions, keyboard/scroll coordination, and per-account history caching.
Startup and tap-to-content timing should then be measured on the real iPhone
under both Wi-Fi and mobile networks. Long-duration session expiry and long-term
server soak testing remain distinct from the completed restart/foreground checks.
