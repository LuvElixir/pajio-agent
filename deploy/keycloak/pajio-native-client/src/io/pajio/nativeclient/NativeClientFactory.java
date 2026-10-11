package io.pajio.nativeclient;

import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Set;
import org.keycloak.Config;
import org.keycloak.events.Event;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.utils.KeycloakModelUtils;
import org.keycloak.models.utils.PostMigrationEvent;

/** Root-activated, idempotent client provisioning; no public maintenance route. */
public final class NativeClientFactory implements EventListenerProviderFactory {
    public String getId() { return "pajio-native-client-v1"; }
    public void init(Config.Scope config) {}
    public void close() {}
    public EventListenerProvider create(KeycloakSession session) {
        return new EventListenerProvider() {
            public void onEvent(Event event) {}
            public void onEvent(AdminEvent event, boolean includeRepresentation) {}
            public void close() {}
        };
    }
    static void require(boolean value) { if (!value) throw new IllegalStateException("native_client_precondition_failed"); }
    static String readSecret() throws java.io.IOException {
        Path file = Path.of("/etc/pajio/native-client-v1.secret");
        for (Path p=file; p!=null; p=p.getParent()) {
            require(!Files.isSymbolicLink(p) && ((Number)Files.getAttribute(p,"unix:uid",LinkOption.NOFOLLOW_LINKS)).intValue()==0);
            var modes=Files.getPosixFilePermissions(p,LinkOption.NOFOLLOW_LINKS);
            require(!modes.contains(java.nio.file.attribute.PosixFilePermission.GROUP_WRITE) && !modes.contains(java.nio.file.attribute.PosixFilePermission.OTHERS_WRITE));
        }
        require(Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS) && Files.size(file)==64 && ((Number)Files.getAttribute(file,"unix:nlink",LinkOption.NOFOLLOW_LINKS)).intValue()==1);
        require(Files.getPosixFilePermissions(file).equals(PosixFilePermissions.fromString("r--r-----")));
        String secret=Files.readString(file); require(secret.matches("[A-Za-z0-9_-]{64}")); return secret;
    }
    static void verify(ClientModel client, String secret) {
        require(client!=null && client.isEnabled() && !client.isPublicClient() && !client.isBearerOnly()
            && client.isDirectAccessGrantsEnabled() && !client.isStandardFlowEnabled()
            && !client.isImplicitFlowEnabled() && !client.isServiceAccountsEnabled()
            && !client.isFullScopeAllowed() && "openid-connect".equals(client.getProtocol())
            && "client-secret".equals(client.getClientAuthenticatorType()) && secret.equals(client.getSecret())
            && client.getRedirectUris().isEmpty() && client.getWebOrigins().isEmpty());
    }
    public void postInit(KeycloakSessionFactory factory) {
        String mode=System.getenv("PAJIO_NATIVE_CLIENT_MIGRATION");
        if (mode==null || mode.isBlank()) return;
        require("create-v1".equals(mode));
        factory.register(event -> {
            if (!(event instanceof PostMigrationEvent)) return;
            try {
                final String secret=readSecret();
                KeycloakModelUtils.runJobInTransaction(factory, session -> {
                    var realm=session.realms().getRealmByName("pajio");
                    require(realm!=null && !realm.isRegistrationAllowed() && realm.isBruteForceProtected());
                    session.getContext().setRealm(realm);
                    var web=realm.getClientByClientId("pajio-app");
                    require(web!=null && web.isStandardFlowEnabled() && !web.isDirectAccessGrantsEnabled());
                    var client=realm.getClientByClientId("pajio-native");
                    if(client==null) {
                        client=realm.addClient("pajio-native");
                        client.setName("Pajio native account login");
                        client.setProtocol("openid-connect"); client.setEnabled(true);
                        client.setPublicClient(false); client.setBearerOnly(false);
                        client.setClientAuthenticatorType("client-secret"); client.setSecret(secret);
                        client.setDirectAccessGrantsEnabled(true); client.setStandardFlowEnabled(false);
                        client.setImplicitFlowEnabled(false); client.setServiceAccountsEnabled(false);
                        client.setFullScopeAllowed(false); client.setRedirectUris(Set.of()); client.setWebOrigins(Set.of());
                        client.setAttribute("access.token.lifespan","60");
                        client.setAttribute("use.refresh.tokens","false");
                        // Use the realm's unchanged password + conditional OTP flow.
                    }
                    verify(client,secret);
                });
                KeycloakModelUtils.runJobInTransaction(factory, session -> verify(session.realms().getRealmByName("pajio").getClientByClientId("pajio-native"),secret));
                System.getLogger(getClass().getName()).log(System.Logger.Level.INFO,"pajio-native-client verified");
            } catch(Exception failure) { throw new IllegalStateException("native_client_migration_failed"); }
        });
    }
}
