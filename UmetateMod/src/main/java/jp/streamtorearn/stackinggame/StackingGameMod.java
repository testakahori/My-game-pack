package jp.streamtorearn.stackinggame;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.core.StackingForgeEvents;
import jp.streamtorearn.stackinggame.core.StackingRuntime;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.ModLoadingContext;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.config.ModConfig;
import org.slf4j.Logger;
import com.mojang.logging.LogUtils;

@Mod(StackingGameMod.MOD_ID)
public final class StackingGameMod {
    public static final String MOD_ID="stackinggame_events";
    public static final Logger LOGGER= LogUtils.getLogger();
    public static final StackingRuntime RUNTIME=new StackingRuntime();

    public StackingGameMod(){
        jp.streamtorearn.stackinggame.lab.LabNetwork.register();
        ModLoadingContext.get().registerConfig(ModConfig.Type.COMMON, StackingConfig.SPEC, "stackinggame-common.toml");
        MinecraftForge.EVENT_BUS.register(new StackingForgeEvents(RUNTIME));
    }
}
