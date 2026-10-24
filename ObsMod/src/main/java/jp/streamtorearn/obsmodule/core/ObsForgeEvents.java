package jp.streamtorearn.obsmodule.core;

import jp.streamtorearn.obsmodule.command.ObsEventCommand;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.entity.living.LivingDamageEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;

public final class ObsForgeEvents {
    private final ObsRuntime rt; public ObsForgeEvents(ObsRuntime rt){this.rt=rt;}
    @SubscribeEvent public void onStarted(ServerStartedEvent e){rt.load();}
    @SubscribeEvent public void onCommands(RegisterCommandsEvent e){ObsEventCommand.register(e.getDispatcher(),rt);}
    @SubscribeEvent public void onDamage(LivingDamageEvent e){ if(e.getEntity().level().isClientSide)return; long tick=e.getEntity().level().getGameTime(); rt.detector.onDamage(e,tick); }
}
