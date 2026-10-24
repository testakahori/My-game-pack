package jp.streamtorearn.stackinggame.client;

import jp.streamtorearn.stackinggame.StackingGameMod;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.common.Mod;

/** Intentionally empty in v2.2. The shared JAR is installed client-side for future HUD/audio/visual extensions. */
@Mod.EventBusSubscriber(modid= StackingGameMod.MOD_ID, value= Dist.CLIENT, bus=Mod.EventBusSubscriber.Bus.MOD)
public final class ClientBootstrap { private ClientBootstrap(){} }
