package jp.streamtorearn.stackinggame.world;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.Vec3;
import net.minecraft.core.particles.ParticleTypes;
public final class SparkService {public void burst(ServerLevel l,Vec3 p,int level){int n=Math.max(6,level*14);l.sendParticles(ParticleTypes.END_ROD,p.x,p.y,p.z,n,1.0,0.8,1.0,0.08);l.sendParticles(ParticleTypes.SOUL_FIRE_FLAME,p.x,p.y,p.z,Math.max(4,level*8),1,0.6,1,0.03);l.sendParticles(ParticleTypes.FIREWORK,p.x,p.y,p.z,Math.max(3,level*5),0.8,0.8,0.8,0.1);}}
