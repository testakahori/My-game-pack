package jp.streamtorearn.stackinggame.event;

import jp.streamtorearn.stackinggame.integration.IntegrationService;
import jp.streamtorearn.stackinggame.integration.StackingEventCatalog;
import net.minecraft.server.MinecraftServer;

/**
 * Central source of StackingGame encounter metadata.
 * Event implementations only say "the player was encountered"; keys/kinds come from Event Master.
 */
public final class EncounterService {
    private final IntegrationService integration;

    public EncounterService(IntegrationService integration) {
        this.integration = integration;
    }

    public boolean notifyEncounter(MinecraftServer server, EventRequest request) {
        StackingEventCatalog.Meta meta = StackingEventCatalog.get(request.eventKey());
        return integration.notifyObsEncounter(server, request, meta.encounterKey(), meta.encounterKind(), meta.attackKind());
    }
}
