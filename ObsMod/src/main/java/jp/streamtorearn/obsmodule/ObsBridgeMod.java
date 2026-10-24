package jp.streamtorearn.obsmodule;

import jp.streamtorearn.obsmodule.core.ObsRuntime;
import jp.streamtorearn.obsmodule.core.ObsForgeEvents;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.common.Mod;
import org.slf4j.Logger;
import com.mojang.logging.LogUtils;

@Mod(ObsBridgeMod.MOD_ID)
public final class ObsBridgeMod {
    public static final String MOD_ID="minecraft_obs_bridge";
    public static final Logger LOGGER= LogUtils.getLogger();
    public static final ObsRuntime RUNTIME=new ObsRuntime();
    public ObsBridgeMod(){ MinecraftForge.EVENT_BUS.register(new ObsForgeEvents(RUNTIME)); }
}
