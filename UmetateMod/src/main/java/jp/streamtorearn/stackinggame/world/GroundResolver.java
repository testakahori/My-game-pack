package jp.streamtorearn.stackinggame.world;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.BlockState;

public final class GroundResolver {
    public BlockPos resolve(ServerLevel level, BlockPos start){
        int min=Math.max(level.getMinBuildHeight(),start.getY()-StackingConfig.GROUND_DEPTH.get());
        int top=Math.min(level.getMaxBuildHeight()-1,start.getY());
        for(int y=top;y>=min;y--){ BlockPos p=new BlockPos(start.getX(),y,start.getZ()); if(!level.hasChunkAt(p))return null; BlockState s=level.getBlockState(p); if(!s.isAir()&&s.getFluidState().isEmpty()&&!s.getCollisionShape(level,p).isEmpty())return p; }
        return null;
    }
}
