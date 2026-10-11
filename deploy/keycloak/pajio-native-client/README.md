# Native account login

Pajio's native username/password form uses the first-party gateway's
`POST /auth/mobile/login`. Password verification stays in Keycloak; the gateway
does not store credentials or send them to Agent Core. A successful provider
login still requires an active invitation membership. Device sessions last 30
days and remain revocable on every request. Web sessions keep their existing
policy. This is a confidential, server-side Direct Grant client; its secret must
never be shipped in the App.

This Keycloak 26.7.4 startup provider provisions only `pajio-native`, without
changing the web client, realm registration, password/OTP flow, or administrator
authentication. It exposes no maintenance HTTP endpoint. The App currently
supports password-only accounts; accounts requiring OTP or another required
action are rejected by Keycloak, not bypassed.

Build with JDK 21 and the deployed Keycloak libraries:

```sh
./build.sh /opt/keycloak-26.7.4/lib/lib/main /private/build-output
```

Back up the identity database and gateway configuration first. Install the JAR
in Keycloak's providers directory and rebuild Keycloak with the deployment's
existing database option. Activation requires both
`PAJIO_NATIVE_CLIENT_MIGRATION=create-v1` and a root-owned, non-symlink
`/etc/pajio/native-client-v1.secret`: exactly 64 URL-safe characters, mode 0440,
readable by the Keycloak service group. All parent directories must be
root-owned and not writable by group/others. Remove the activation environment
after the one successful restart. Configure the same secret in the gateway's
private `native_client_secret` setting. Never place it in version control.

Without the activation environment this provider is inert. Without the gateway
secret native login returns 503. For rollback clear that gateway setting and
disable the `pajio-native` client using the normal authorized administrator
workflow; this leaves web login and existing gateway sessions intact. Do not
restore a full identity database over newly registered users.

Validate valid credentials, an uninvited identity, invalid credentials, current
membership revocation, request bounds and rate limiting. Logs and test evidence
must not contain passwords, provider tokens or gateway session tokens.
