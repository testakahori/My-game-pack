package jp.douma.doumacmd;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.network.protocol.game.ClientboundSetEntityMotionPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.entity.boss.wither.WitherBoss;
import net.minecraft.tags.FluidTags;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.entity.projectile.Arrow;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.LiquidBlock;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.function.IntConsumer;

/** Server-thread effects. Large gifts are spread across ticks instead of spawning everything in one tick. */
final class GiftEffects {
    static final Set<String> KEYS = Set.of("flood", "bullettime", "anvildrop", "chickenrain", "meteor",
        "skytrap", "superjump", "volcano", "zombiewave", "iceage", "storm", "clearweather", "cataclysm", "meteorshower", "witherhunt", "heavygravity");
    static final int JUMP_HEIGHT = 32;
    private final List<Job> jobs = new ArrayList<>();
    private final List<MeteorFlight> meteorFlights = new ArrayList<>();
    private final Map<UUID, Jump> jumps = new HashMap<>();
    private final Map<String, Long> weatherEnds = new HashMap<>();
    private final Map<String, Blizzard> blizzards = new HashMap<>();
    private final Map<UUID, IcePrison> icePrisons = new HashMap<>();
    private final Map<UUID, Long> heavyPlayers = new HashMap<>();
    private final Map<UUID, WitherHunt> witherHunts = new HashMap<>();
    private record WitherHunt(WitherBoss wither, UUID player) {}
    private long ticks;
    private Path weatherFile;
    private int failures;
    private String lastError = "";

    record Protection(boolean enabled, double x1, double x2, double z1, double z2) {
        boolean contains(double x, double z) {
            return enabled && x >= Math.min(x1, x2) && x <= Math.max(x1, x2)
                && z >= Math.min(z1, z2) && z <= Math.max(z1, z2);
        }
    }
    private static final Protection NONE = new Protection(false, 0, 0, 0, 0);
    private record Origin(ServerLevel level, Vec3 pos, Protection protection) {
        boolean allowed(BlockPos p) {
            return p.getY() >= level.getMinBuildHeight() && p.getY() < level.getMaxBuildHeight()
                && level.hasChunkAt(p) && !protection.contains(p.getX(), p.getZ());
        }
    }
    private static final class Job {
        int index; final int total, interval, perTick; long next;
        final IntConsumer action;
        List<Job> prerequisites = List.of();
        Job(int total, int interval, int perTick, long next, IntConsumer action) {
            this.total = total; this.interval = interval; this.perTick = perTick; this.next = next; this.action = action;
        }
    }
    private static final class Jump {
        final ServerLevel level; double target, liftY; boolean coasting; int age;
        Jump(ServerPlayer p) { level = p.serverLevel(); target = liftY = p.getY(); }
    }
    private record Blizzard(Origin origin, long ends) {}
    private record IcePrison(Origin origin, BlockPos centre, long ends) {}

    void load(MinecraftServer server) {
        weatherFile = server.getServerDirectory().toPath().resolve("douma-weather-timers.properties");
        if (!Files.isRegularFile(weatherFile)) return;
        try (InputStream in = Files.newInputStream(weatherFile)) {
            Properties data = new Properties(); data.load(in);
            for (String dimension : data.stringPropertyNames()) weatherEnds.put(dimension, Long.parseLong(data.getProperty(dimension)));
        } catch (Exception e) { fail(e); }
    }
    private void saveWeather() {
        if (weatherFile == null) return;
        try (OutputStream out = Files.newOutputStream(weatherFile)) {
            Properties data = new Properties(); weatherEnds.forEach((k, v) -> data.setProperty(k, v.toString()));
            data.store(out, "Gift weather expiry (epoch milliseconds; independent of doWeatherCycle)");
        } catch (Exception e) { fail(e); }
    }
    void stop() { saveWeather(); jobs.clear(); meteorFlights.forEach(m -> m.blocks.forEach(FallingBlockEntity::discard)); meteorFlights.clear(); jumps.clear(); blizzards.clear(); icePrisons.clear(); heavyPlayers.clear(); witherHunts.clear(); weatherEnds.clear(); }
    int pendingJobs() { return jobs.size() + meteorFlights.size(); }
    int failures() { return failures; }
    String lastError() { return lastError; }
    private void fail(Exception e) { failures++; lastError = e.toString(); System.err.println("[Douma effects] " + lastError); }
    private Job job(int total, int interval, int perTick, IntConsumer action) {
        Job next = new Job(total, interval, perTick, ticks, action);
        jobs.add(next);
        return next;
    }

    int start(CommandSourceStack source, String key, int count, Protection protection) throws Exception {
        if (!KEYS.contains(key)) throw new IllegalArgumentException("Unknown effect: " + key);
        ServerLevel level = source.getLevel();
        Origin o = new Origin(level, source.getPosition(), protection == null ? NONE : protection);
        switch (key) {
            case "clearweather" -> clearWeather(level);
            case "storm" -> { rain(level, 180); lightning(o, 20); }
            case "iceage" -> { iceage(o); fallingIce(o, source.getPlayerOrException(), count); }
            case "superjump" -> jump(source.getPlayerOrException(), count);
            case "skytrap" -> skytrap(source.getPlayerOrException());
            case "flood" -> flood(o, 30 * count);
            case "bullettime" -> bullets(o, 240 * count);
            case "anvildrop" -> anvils(o, 100 * count);
            case "chickenrain" -> chickens(o, 200 * count);
            case "meteor" -> meteors(o, 100 * count);
            case "meteorshower" -> meteorShower(o, 50 * count, source.getPlayerOrException());
            case "witherhunt" -> huntWithers(o, source.getPlayerOrException());
            case "heavygravity" -> heavyGravity(source.getPlayerOrException());
            case "volcano" -> volcano(o, 50 * count);
            case "zombiewave" -> zombies(o, 50 * count);
            case "cataclysm" -> cataclysm(o, count, source.getPlayerOrException());
        }
        return 1;
    }

    void tick(MinecraftServer server) {
        ticks++;
        // One global budget includes all concurrently received gifts. No command loses its requested count.
        int entityBudget = 16, blockBudget = 512;
        for (Iterator<Job> it = jobs.iterator(); it.hasNext();) {
            Job j = it.next();
            if (j.next > ticks || j.prerequisites.stream().anyMatch(p -> p.index < p.total)) continue;
            boolean blocks = j.perTick > 16;
            int n = Math.min(j.perTick, Math.min(j.total - j.index, blocks ? blockBudget : entityBudget));
            for (int i = 0; i < n; i++) {
                try { j.action.accept(j.index++); } catch (Exception e) { fail(e); j.index = j.total; break; }
            }
            if (blocks) blockBudget -= n; else entityBudget -= n;
            if (n > 0) j.next = ticks + j.interval;
            if (j.index >= j.total) it.remove();
        }
        tickJumps(server);
        tickIcePrisons(server);
        tickMeteors();
        tickHuntersAndGravity(server);
        long now = System.currentTimeMillis();
        for (ServerLevel level : server.getAllLevels()) {
            String id = level.dimension().location().toString();
            Long end = weatherEnds.get(id);
            if (end != null && now >= end) clearWeather(level);
        }
        blizzards.values().removeIf(b -> now >= b.ends);
        if (ticks % 4 == 0) for (Blizzard b : blizzards.values()) {
            Origin o = b.origin;
            o.level.sendParticles(ParticleTypes.SNOWFLAKE, o.pos.x, o.pos.y + 8, o.pos.z, 300, 48, 10, 48, 0.2);
            o.level.sendParticles(ParticleTypes.CLOUD, o.pos.x, o.pos.y + 2, o.pos.z, 50, 32, 3, 32, 0.3);
        }
    }

    private void rain(ServerLevel level, int seconds) {
        level.getServer().getCommands().performPrefixedCommand(level.getServer().createCommandSourceStack().withSuppressedOutput(),
            "execute if score #storm douma_storm matches 1.. run scoreboard players set #storm douma_storm 0");
        level.setWeatherParameters(0, seconds * 20, true, true);
        weatherEnds.put(level.dimension().location().toString(), System.currentTimeMillis() + seconds * 1000L);
        saveWeather();
    }
    private void clearWeather(ServerLevel level) {
        level.setWeatherParameters(6000, 0, false, false);
        weatherEnds.remove(level.dimension().location().toString());
        blizzards.remove(level.dimension().location().toString());
        saveWeather();
        // Retire the old datapack timer as well, so it cannot interrupt a later weather gift.
        level.getServer().getCommands().performPrefixedCommand(level.getServer().createCommandSourceStack().withSuppressedOutput(),
            "execute if score #storm douma_storm matches 1.. run scoreboard players set #storm douma_storm 0");
    }
    private int surface(Origin o, int x, int z) {
        return o.level.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, x, z);
    }
    private boolean loaded(Origin o, int x, int z) { return o.level.hasChunkAt(new BlockPos(x, 0, z)); }
    private void set(Origin o, BlockPos p, net.minecraft.world.level.block.state.BlockState state) {
        if (o.allowed(p) && o.level.getBlockEntity(p) == null && !o.level.getBlockState(p).is(Blocks.BEDROCK)) o.level.setBlock(p, state, 3);
    }
    private void summon(Origin o, String entity, double x, double y, double z, String nbt) {
        BlockPos p = BlockPos.containing(x, y, z);
        if (!o.allowed(p)) return;
        String command = String.format(Locale.ROOT, "summon minecraft:%s %.3f %.3f %.3f %s", entity, x, y, z, nbt);
        int result = o.level.getServer().getCommands().performPrefixedCommand(o.level.getServer().createCommandSourceStack()
            .withLevel(o.level).withPermission(4).withSuppressedOutput(), command);
        if (result == 0) throw new IllegalStateException("Effect summon failed: " + entity);
    }
    private double high(Origin o, int height) { return Math.min(o.level.getMaxBuildHeight() - 2, o.pos.y + height); }
    private double random(Origin o, double radius) { return (o.level.random.nextDouble() * 2 - 1) * radius; }

    private void flood(Origin o, int drowned) {
        int top = (int)high(o, 48), bottom = Math.max(o.level.getMinBuildHeight(), (int)Math.floor(o.pos.y));
        if (top <= bottom) return;
        int centreX = (int)Math.floor(o.pos.x), centreZ = (int)Math.floor(o.pos.z);
        // Lay down the waterfall from top to bottom at the shared block budget (~3 seconds).
        // Animals wait for the water column and are placed inside it, with no downward impulse.
        Job water = job((top - bottom + 1) * 625, 1, 512, i -> {
            BlockPos p = new BlockPos(centreX + i % 25 - 12, top - i / 625, centreZ + i / 25 % 25 - 12);
            if (o.level.getBlockState(p).canBeReplaced()) set(o, p, i < 625 ? Blocks.WATER.defaultBlockState()
                : Blocks.WATER.defaultBlockState().setValue(LiquidBlock.LEVEL, 8));
        });
        String[] types = {"drowned", "cod", "salmon", "tropical_fish", "pufferfish", "squid", "glow_squid", "dolphin", "turtle", "axolotl", "guardian", "elder_guardian"};
        int[] quantities = {30, 24, 24, 30, 12, 12, 9, 9, 9, 9, 12, 3};
        int perGift = Arrays.stream(quantities).sum();
        Job animals = job(perGift * (drowned / 30), 2, 4, i -> {
            int slot = i % perGift, species = 0;
            while (slot >= quantities[species]) slot -= quantities[species++];
            for (int attempt = 0; attempt < 40; attempt++) {
                int x = centreX + o.level.random.nextInt(19) - 9, z = centreZ + o.level.random.nextInt(19) - 9;
                int y = Math.min(top - 2, bottom + 2 + o.level.random.nextInt(Math.max(1, Math.min(17, top - bottom - 3))));
                BlockPos p = new BlockPos(x, y, z);
                if (!o.allowed(p) || !o.level.getFluidState(p).is(FluidTags.WATER)
                        || !o.level.getFluidState(p.above()).is(FluidTags.WATER)) continue;
                String extra = types[species].equals("tropical_fish")
                    ? ",Variant:" + new int[]{0, 65536, 16777216, 67108865, 117506305, 117899265}[i % 6] : "";
                summon(o, types[species], x + 0.5, y + 0.2, z + 0.5,
                    "{Tags:[\"douma_flood\"],Motion:[0.0,0.0,0.0]" + extra + "}");
                return;
            }
        });
        animals.prerequisites = List.of(water);
    }
    private void anvils(Origin o, int total) {
        // 100 blocks: three 5x5 layers, two 3x3 layers, a cross and a two-block peak.
        // The outside arrives before the centre, building walls before the crushing blows.
        List<BlockPos> pile = new ArrayList<>();
        for (int layer = 0; layer < 8; layer++) {
            int radius = layer < 3 ? 2 : layer < 6 ? 1 : 0;
            for (int ring = radius; ring >= 0; ring--) {
                for (int x = -radius; x <= radius; x++) for (int z = -radius; z <= radius; z++) {
                    if (Math.max(Math.abs(x), Math.abs(z)) != ring) continue;
                    if (layer == 5 && Math.abs(x) + Math.abs(z) > 1) continue;
                    pile.add(new BlockPos(x, layer, z));
                }
            }
        }
        BlockPos centre = BlockPos.containing(o.pos);
        job(total, 1, 10, i -> {
            BlockPos offset = pile.get(i % pile.size());
            int x = centre.getX() + offset.getX(), z = centre.getZ() + offset.getZ();
            if (!loaded(o, x, z)) return;
            // Separate successive layers vertically so each can settle instead of overwriting
            // another falling entity at the same landing cell. Repeated gifts build on the pile.
            double y = Math.min(o.level.getMaxBuildHeight() - 2,
                Math.max(o.pos.y + 28, surface(o, x, z) + 10) + offset.getY() * 3);
            summon(o, "falling_block", x + 0.5, y, z + 0.5,
                "{Tags:[\"douma_anvildrop\"],BlockState:{Name:\"minecraft:anvil\"},Time:1,DropItem:0b,HurtEntities:1b,FallHurtAmount:4.0f,FallHurtMax:80,Motion:[0.0,-2.8,0.0]}");
        });
    }
    private void chickens(Origin o, int total) {
        job(total, 1, 10, i -> summon(o, "chicken", o.pos.x + random(o, 12), high(o, 24 + i % 10), o.pos.z + random(o, 12),
            "{Tags:[\"douma_chickenrain\"],Motion:[0.0,-0.5,0.0]}"));
    }
    private void meteors(Origin o, int total) {
        job(total, 2, 4, i -> summon(o, "fireball", o.pos.x + random(o, 24), high(o, 40 + i % 12), o.pos.z + random(o, 24),
            "{Tags:[\"douma_meteor\"],ExplosionPower:2b,power:[0.0,-0.25,0.0],Motion:[0.0,-1.8,0.0]}"));
    }

    private static final List<BlockPos> METEOR_SHAPE = meteorShape();
    private static List<BlockPos> meteorShape() {
        List<BlockPos> points = new ArrayList<>();
        for (int x=-2;x<=2;x++) for(int y=-2;y<=2;y++) for(int z=-2;z<=2;z++) points.add(new BlockPos(x,y,z));
        points.sort(Comparator.comparingDouble(p -> p.getX()*p.getX()+p.getY()*p.getY()+p.getZ()*p.getZ()
            + Math.floorMod(p.getX()*31+p.getY()*17+p.getZ()*13,19)*0.013));
        return List.copyOf(points.subList(0,50));
    }
    private static final class MeteorFlight {
        final Origin origin;
        final Vec3 start, target, velocity;
        Vec3 previous;
        final long launched;
        final int duration;
        final boolean large, explosive, remnant;
        final Block material;
        final List<FallingBlockEntity> blocks = new ArrayList<>();
        final Set<UUID> hitPlayers = new HashSet<>();
        boolean ended;
        MeteorFlight(Origin origin, Vec3 start, Vec3 target, long launched, boolean large, Block material, int index) {
            this.origin=origin;this.start=this.previous=start;this.target=target;this.launched=launched;
            this.large=large;this.material=material;
            explosive=large && index%2==0;
            remnant=large || index%5==0;
            Vec3 delta=target.subtract(start);
            duration=Math.max(12,(int)Math.ceil(delta.length()/(large?3.6:4.2)));
            velocity=delta.scale(1.0/duration);
        }
    }
    private Job meteorShower(Origin o, int clusters, ServerPlayer targetPlayer) {
        Block[] materials={Blocks.MAGMA_BLOCK,Blocks.BEDROCK,Blocks.DEEPSLATE,Blocks.GOLD_BLOCK,Blocks.OBSIDIAN};
        Map<Integer,MeteorFlight> groups=new HashMap<>();
        UUID targetId=targetPlayer.getUUID();
        // Fifty touching blocks form an irregular boulder; ten fragments accompany each one.
        return job(clusters*60,1,12,i->{
            int wave=i/60,part=i%60;
            MeteorFlight flight=part<50
                ?groups.computeIfAbsent(wave,n->launchMeteor(o,n,true,materials[n%materials.length],targetId))
                :launchMeteor(o,wave*10+part-50,false,materials[(wave+part)%materials.length],targetId);
            if(flight.ended)return;
            BlockPos offset=part<50?METEOR_SHAPE.get(part):BlockPos.ZERO;
            Vec3 position=flight.start.add(flight.velocity.scale(ticks-flight.launched)).add(offset.getX(),offset.getY(),offset.getZ());
            if(!o.allowed(BlockPos.containing(position)))return;
            FallingBlockEntity block=EntityType.FALLING_BLOCK.create(o.level);
            if(block==null)throw new IllegalStateException("Cannot create meteor block");
            CompoundTag data=new CompoundTag(),state=new CompoundTag();
            state.putString("Name",BuiltInRegistries.BLOCK.getKey(flight.material).toString());
            data.put("BlockState",state);data.putInt("Time",1);
            data.putBoolean("DropItem",false);data.putBoolean("CancelDrop",true);
            block.load(data);block.setNoGravity(true);block.setPos(position);block.setDeltaMovement(flight.velocity);
            block.addTag("douma_meteorshower");
            block.addTag(flight.large?"douma_meteor_cluster":"douma_meteor_fragment");
            o.level.addFreshEntity(block);flight.blocks.add(block);
        });
    }
    private MeteorFlight launchMeteor(Origin o,int index,boolean large,Block material,UUID targetId) {
        ServerPlayer player=o.level.getServer().getPlayerList().getPlayer(targetId);
        Vec3 focus=player!=null&&player.isAlive()&&player.serverLevel()==o.level?player.position():o.pos;
        double angle=index*2.3999632297+(large?0:0.7);
        boolean aimed=large?index%3==0:index%7==0;
        double radius=aimed?0:large?4+index%5*5:3+o.level.random.nextDouble()*29;
        int x=(int)Math.floor(focus.x+Math.cos(angle)*radius),z=(int)Math.floor(focus.z+Math.sin(angle)*radius);
        int ground=loaded(o,x,z)?o.level.getHeight(Heightmap.Types.OCEAN_FLOOR,x,z):(int)focus.y;
        Vec3 target=new Vec3(x+.5,ground+(large?2:0),z+.5);
        double approach=angle+.8,side=large?48:36;
        Vec3 start=target.add(Math.cos(approach)*side,
            Math.min(o.level.getMaxBuildHeight()-5,Math.max(focus.y,ground)+(large?76:64))-target.y,Math.sin(approach)*side);
        MeteorFlight flight=new MeteorFlight(o,start,target,ticks,large,material,index);
        if(o.allowed(BlockPos.containing(start))&&o.allowed(BlockPos.containing(target)))meteorFlights.add(flight);
        else flight.ended=true;
        return flight; // The aim is fixed at launch; running away can evade it.
    }
    private void hitMeteorPlayers(MeteorFlight meteor,Vec3 position,FallingBlockEntity lead) {
        double radius=meteor.large?2.25:.45;
        AABB swept=new AABB(meteor.previous,position).inflate(radius+1);
        for(ServerPlayer player:meteor.origin.level.getEntitiesOfClass(ServerPlayer.class,swept)) {
            if(!player.isAlive()||player.isCreative()||player.isSpectator()||meteor.hitPlayers.contains(player.getUUID())
                ||meteor.origin.protection.contains(player.getX(),player.getZ()))continue;
            AABB hitbox=player.getBoundingBox().inflate(radius);
            if(!hitbox.contains(meteor.previous)&&hitbox.clip(meteor.previous,position).isEmpty())continue;
            meteor.hitPlayers.add(player.getUUID());
            player.hurt(meteor.origin.level.damageSources().fallingBlock(lead),meteor.large?18.0f:4.0f);
            player.knockback(meteor.large?1.0:.35,-meteor.velocity.x,-meteor.velocity.z);
        }
        meteor.previous=position;
    }
    private void tickMeteors() {
        for(Iterator<MeteorFlight> it=meteorFlights.iterator();it.hasNext();) {
            MeteorFlight meteor=it.next();
            FallingBlockEntity lead=meteor.blocks.isEmpty()?null:meteor.blocks.get(0);
            Vec3 current=lead==null?meteor.start:lead.position();
            if(lead!=null)hitMeteorPlayers(meteor,current,lead);
            if(ticks-meteor.launched>=meteor.duration||(lead!=null&&lead.isRemoved())) {
                Vec3 impact=lead!=null&&lead.isRemoved()?lead.position():meteor.target.add(0,meteor.large?-2:0,0);
                meteor.ended=true;meteor.blocks.forEach(FallingBlockEntity::discard);it.remove();
                if(meteor.origin.allowed(BlockPos.containing(impact)))meteorImpact(meteor,impact);
                continue;
            }
            for(FallingBlockEntity block:meteor.blocks)if(!block.isRemoved())block.setDeltaMovement(meteor.velocity);
            if(lead==null||ticks%(meteor.large?2:4)!=0)continue;
            double spread=meteor.large?1.7:.12;
            for(int trail=0;trail<(meteor.large?4:2);trail++) {
                Vec3 tail=current.subtract(meteor.velocity.scale(trail*.8));
                meteor.origin.level.sendParticles(meteor.material==Blocks.OBSIDIAN?ParticleTypes.SOUL_FIRE_FLAME:ParticleTypes.FLAME,
                    tail.x,tail.y+1,tail.z,meteor.large?8:1,spread,spread,spread,.015);
                meteor.origin.level.sendParticles(ParticleTypes.END_ROD,tail.x,tail.y+1,tail.z,meteor.large?4:1,spread,spread,spread,.02);
            }
        }
    }
    private void meteorImpact(MeteorFlight meteor,Vec3 impact) {
        Origin o=meteor.origin;
        if(meteor.explosive)o.level.explode(null,impact.x,impact.y,impact.z,3.5f,Level.ExplosionInteraction.NONE);
        else o.level.playSound(null,impact.x,impact.y,impact.z,SoundEvents.STONE_BREAK,SoundSource.BLOCKS,meteor.large?3.0f:.35f,.65f);
        o.level.sendParticles(ParticleTypes.CLOUD,impact.x,impact.y+.4,impact.z,
            meteor.large?70:8,meteor.large?5:1,.3,meteor.large?5:1,.16);
        int radius=meteor.large?5+o.level.random.nextInt(2):1;
        int depth=meteor.large?5:2,side=radius*2+1;
        BlockPos centre=BlockPos.containing(impact);
        Job crater=job(side*side*(depth+3),1,64,i->{
            int x=i%side-radius,z=i/side%side-radius,down=i/(side*side)-1;
            double distance=Math.sqrt(x*x+z*z);
            int cut=(int)Math.ceil(depth*(1.0-distance/(radius+.5)));
            if(distance<=radius&&down<=cut)set(o,centre.offset(x,-down,z),Blocks.AIR.defaultBlockState());
        });
        if(meteor.remnant) {
            int pieces=meteor.large?(meteor.explosive?8:24):1;
            Job debris=job(pieces,1,32,i->{
                BlockPos offset=METEOR_SHAPE.get(i);
                set(o,centre.offset(offset.getX(),-depth+2+offset.getY(),offset.getZ()),meteor.material.defaultBlockState());
            });
            debris.prerequisites=List.of(crater);
        }
    }

    private void volcano(Origin o, int total) {
        int floor = (int)Math.floor(o.pos.y) - 1;
        job(21 * 21, 1, 64, i -> set(o, new BlockPos((int)Math.floor(o.pos.x) + i % 21 - 10, floor,
            (int)Math.floor(o.pos.z) + i / 21 - 10), Blocks.LAVA.defaultBlockState()));
        job(total, 2, 2, i -> {
            double angle = o.level.random.nextDouble() * Math.PI * 2;
            int x = (int)Math.floor(o.pos.x + Math.cos(angle) * 5), z = (int)Math.floor(o.pos.z + Math.sin(angle) * 5);
            if (!loaded(o, x, z)) return;
            int y = surface(o, x, z);
            set(o, new BlockPos(x, y - 1, z), Blocks.LAVA.defaultBlockState());
            String nbt = String.format(Locale.ROOT, "{Tags:[\"douma_volcano\"],BlockState:{Name:\"minecraft:magma_block\"},Time:1,DropItem:0b,HurtEntities:1b,FallHurtAmount:3.0f,FallHurtMax:60,Motion:[%.3f,1.8,%.3f]}", Math.cos(angle)*0.65, Math.sin(angle)*0.65);
            summon(o, "falling_block", x + 0.5, y + 1, z + 0.5, nbt);
            o.level.sendParticles(ParticleTypes.LAVA, x + 0.5, y + 1, z + 0.5, 24, 0.5, 2, 0.5, 0.1);
            o.level.sendParticles(ParticleTypes.FLAME, x + 0.5, y + 2, z + 0.5, 40, 0.5, 3, 0.5, 0.2);
        });
    }
    private void zombies(Origin o, int each) {
        String[] types = {"zombie", "husk", "drowned", "zombie_villager"};
        job(each * types.length, 1, 10, i -> {
            double angle = o.level.random.nextDouble() * Math.PI * 2, radius = 8 + o.level.random.nextDouble() * 12;
            int x = (int)Math.floor(o.pos.x + Math.cos(angle)*radius), z = (int)Math.floor(o.pos.z + Math.sin(angle)*radius);
            if (loaded(o, x, z)) summon(o, types[i % types.length], x + 0.5, surface(o, x, z), z + 0.5, "{Tags:[\"douma_zombiewave\"]}");
        });
    }
    private void bullets(Origin o, int total) {
        job(total, 3, 4, i -> {
            double angle = o.level.random.nextDouble() * Math.PI * 2;
            Vec3 start = new Vec3(o.pos.x + Math.cos(angle)*16, o.pos.y + 1 + o.level.random.nextDouble()*7, o.pos.z + Math.sin(angle)*16);
            if (!o.allowed(BlockPos.containing(start))) return;
            List<LivingEntity> targets = o.level.getEntitiesOfClass(LivingEntity.class, new AABB(o.pos, o.pos).inflate(18), e -> e.isAlive() && !e.isSpectator());
            Vec3 target = targets.isEmpty() ? o.pos.add(random(o, 8), 1, random(o, 8))
                : targets.get(o.level.random.nextInt(targets.size())).getEyePosition();
            Vec3 direction = target.subtract(start);
            Arrow arrow = new Arrow(EntityType.ARROW, o.level);
            arrow.setPos(start); arrow.setBaseDamage(4); arrow.setPierceLevel((byte)2);
            arrow.addTag("douma_bullettime");
            arrow.shoot(direction.x, direction.y, direction.z, 2.8f, 5);
            o.level.addFreshEntity(arrow); // No owner/team: players, allies and enemies can all be hit.
        });
    }
    private void lightning(Origin o, int total) {
        job(total, 2, 1, i -> {
            int x = (int)Math.floor(o.pos.x + random(o, 24)), z = (int)Math.floor(o.pos.z + random(o, 24));
            if (loaded(o, x, z)) summon(o, "lightning_bolt", x, surface(o, x, z), z, "{Tags:[\"douma_lightning\"]}");
        });
    }
    private Job iceage(Origin o) {
        rain(o.level, 120);
        blizzards.put(o.level.dimension().location().toString(), new Blizzard(o, System.currentTimeMillis() + 120000));
        for (ServerPlayer p : o.level.players()) if (p.position().distanceTo(o.pos) <= 72) {
            p.addEffect(new MobEffectInstance(MobEffects.DARKNESS, 2400, 0, false, false));
        }
        // 97 x 97 terrain surface; ice/snow intentionally remain after the two-minute blizzard.
        return job(97 * 97, 1, 256, i -> {
            int x = (int)Math.floor(o.pos.x) + i % 97 - 48, z = (int)Math.floor(o.pos.z) + i / 97 - 48;
            if (!loaded(o, x, z)) return;
            int y = surface(o, x, z);
            BlockPos ground = new BlockPos(x, y - 1, z);
            if (!o.level.getBlockState(ground).isAir()) set(o, ground, Blocks.PACKED_ICE.defaultBlockState());
            BlockPos snow = ground.above();
            if (o.level.getBlockState(snow).isAir()) set(o, snow, Blocks.SNOW.defaultBlockState());
        });
    }
    private void fallingIce(Origin o, ServerPlayer player, int count) {
        BlockPos centre = player.blockPosition();
        if (!o.allowed(centre) || !o.allowed(centre.above())) return;
        // A 5x5 slab, three layers thick, falls before any confinement damage begins.
        job(75 * count, 1, 15, i -> {
            int layer = i / 25, x = centre.getX() + i % 5 - 2, z = centre.getZ() + i / 5 % 5 - 2;
            summon(o, "falling_block", x + 0.5, Math.min(o.level.getMaxBuildHeight()-2, centre.getY()+24+layer*3), z + 0.5,
                "{Tags:[\"douma_icefall\"],BlockState:{Name:\"minecraft:packed_ice\"},Time:1,DropItem:0b,HurtEntities:1b,FallHurtAmount:4.0f,FallHurtMax:60,Motion:[0.0,-2.8,0.0]}");
        });
        icePrisons.put(player.getUUID(), new IcePrison(o, centre, System.currentTimeMillis() + 120000));
    }
    private boolean insidePrison(ServerPlayer player, BlockPos centre) {
        return Math.abs(player.getX() - (centre.getX() + 0.5)) < 2.8
            && Math.abs(player.getZ() - (centre.getZ() + 0.5)) < 2.8
            && player.getY() >= centre.getY() - 1 && player.getY() < centre.getY() + 4;
    }
    private boolean intersectsIce(ServerPlayer player) {
        return BlockPos.betweenClosedStream(player.getBoundingBox().deflate(0.05))
            .anyMatch(pos -> player.serverLevel().getBlockState(pos).is(Blocks.PACKED_ICE));
    }
    private void tickIcePrisons(MinecraftServer server) {
        if (ticks % 10 != 0) return;
        long now = System.currentTimeMillis();
        for (Iterator<Map.Entry<UUID, IcePrison>> it = icePrisons.entrySet().iterator(); it.hasNext();) {
            var entry = it.next(); IcePrison prison = entry.getValue();
            ServerPlayer player = server.getPlayerList().getPlayer(entry.getKey());
            if (now >= prison.ends || player == null || !player.isAlive()
                    || player.serverLevel() != prison.origin.level || !insidePrison(player, prison.centre)) {
                if (player != null) player.setTicksFrozen(0);
                it.remove(); continue;
            }
            if (intersectsIce(player)) {
                player.setTicksFrozen(300);
                player.hurt(prison.origin.level.damageSources().freeze(), 2.0f);
            } else {
                player.setTicksFrozen(0);
            }
        }
    }

    private Job earthquakeCrater(Origin o) {
        int centreX = (int)Math.floor(o.pos.x), centreZ = (int)Math.floor(o.pos.z);
        int top = (int)Math.floor(o.pos.y) + 1;
        int bottom = Math.max(o.level.getMinBuildHeight() + 1, (int)Math.floor(o.pos.y) - 48);
        int[] floors = new int[13 * 13];
        for (int i = 0; i < floors.length; i++) {
            int x = i % 13 - 6, z = i / 13 - 6;
            int ring = Math.max(Math.abs(x), Math.abs(z));
            // A deep central shaft surrounded by uneven, broken crater walls.
            int depth = ring <= 3 ? 48 : 48 - (ring - 3) * 6 - o.level.random.nextInt(5);
            floors[i] = Math.max(bottom, (int)Math.floor(o.pos.y) - depth);
        }
        return job((top - bottom + 1) * floors.length, 1, 256, i -> {
            int column = i % floors.length;
            int dx = column % 13 - 6, dz = column / 13 - 6;
            int y = top - i / floors.length;
            if (dx * dx + dz * dz <= 43 && y >= floors[column])
                set(o, new BlockPos(centreX + dx, y, centreZ + dz), Blocks.AIR.defaultBlockState());
        });
    }

    private void cataclysm(Origin o, int count, ServerPlayer target) {
        Job crater = earthquakeCrater(o);
        Job frost = iceage(o); rain(o.level, 180); lightning(o, 20);
        // Jagged fissures cross a broad area. Each cut is small enough to keep a tick bounded.
        Job fissures = job(120, 1, 2, i -> {
            double direction = (i / 20) * Math.PI / 3;
            double distance = (i % 20) * 3;
            if (distance < 12) return; // Keep repeated surface cuts out of the central shaft.
            int x = (int)Math.floor(o.pos.x + Math.cos(direction) * distance + random(o, 2));
            int z = (int)Math.floor(o.pos.z + Math.sin(direction) * distance + random(o, 2));
            if (!loaded(o, x, z)) return;
            int top = surface(o, x, z), depth = 5 + o.level.random.nextInt(14);
            for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++) for (int y = top; y >= top - depth; y--)
                set(o, new BlockPos(x + dx, y, z + dz), Blocks.AIR.defaultBlockState());
        });
        UUID targetId = target.getUUID();
        // Start pouring only after excavation/freezing; neither may erase the lava sources.
        // Refresh for 30 seconds, aiming at the player while they remain in the crater.
        Job lava = job(30, 20, 1, i -> {
            ServerPlayer player = o.level.getServer().getPlayerList().getPlayer(targetId);
            int x = (int)Math.floor(o.pos.x), z = (int)Math.floor(o.pos.z);
            if (player != null && player.isAlive() && player.serverLevel() == o.level
                    && Math.abs(player.getX() - o.pos.x) <= 6 && Math.abs(player.getZ() - o.pos.z) <= 6) {
                x = player.getBlockX(); z = player.getBlockZ();
            }
            int y = (int)high(o, 12);
            for (int dx = -2; dx <= 2; dx++) for (int dz = -2; dz <= 2; dz++) {
                BlockPos p = new BlockPos(x + dx, y, z + dz);
                if (o.level.getBlockState(p).canBeReplaced() || o.level.getBlockState(p).is(Blocks.LAVA))
                    set(o, p, Blocks.LAVA.defaultBlockState());
            }
        });
        lava.prerequisites = List.of(crater, frost, fissures);
        Job apocalypseSky = meteorShower(o, 50 * count, target);
        apocalypseSky.prerequisites = List.of(crater, frost, fissures);
        o.level.playSound(null, o.pos.x, o.pos.y, o.pos.z, SoundEvents.WITHER_SPAWN, SoundSource.HOSTILE, 2.0f, 0.6f);
        int streamTop = (int)high(o, 12) - 1;
        int streamBottom = Math.max(o.level.getMinBuildHeight() + 1, (int)Math.floor(o.pos.y) - 48);
        // Advance a falling liquid column from the sky into the pit. Vanilla lava alone
        // takes over a minute to descend this far, losing the impact of the earthquake.
        Job stream = job(Math.max(0, streamTop - streamBottom + 1) * 25, 4, 25, i -> {
            int x = (int)Math.floor(o.pos.x) + i % 5 - 2;
            int z = (int)Math.floor(o.pos.z) + (i % 25) / 5 - 2;
            BlockPos p = new BlockPos(x, streamTop - i / 25, z);
            if (o.level.getBlockState(p).canBeReplaced())
                set(o, p, Blocks.LAVA.defaultBlockState().setValue(LiquidBlock.LEVEL, 8));
        });
        stream.prerequisites = List.of(crater, frost, fissures);
        job(100 * count, 2, 4, i -> summon(o, "tnt", o.pos.x + random(o, 28), high(o, 40 + i % 10), o.pos.z + random(o, 28), "{Tags:[\"douma_cataclysm\"],Fuse:70s,Motion:[0.0,-1.0,0.0]}"));
        job(50 * count, 1, 5, i -> {
            int x = (int)Math.floor(o.pos.x + random(o, 18)), z = (int)Math.floor(o.pos.z + random(o, 18));
            if (loaded(o, x, z)) summon(o, "zombified_piglin", x + 0.5, surface(o, x, z), z + 0.5, "{Tags:[\"douma_cataclysm\"]}");
        });
        summon(o, "wither", o.pos.x + 10, Math.min(o.level.getMaxBuildHeight()-2, o.pos.y + 10), o.pos.z, "{Tags:[\"douma_cataclysm\"],Invul:100}");
        huntWithers(o, target);
    }

    private void huntWithers(Origin o, ServerPlayer player) {
        for (WitherBoss wither : o.level.getEntitiesOfClass(WitherBoss.class, new AABB(o.pos, o.pos).inflate(40))) {
            if (!wither.getTags().contains("gift_spawn_new") && !wither.getTags().contains("douma_cataclysm")
                    && !wither.getTags().contains("douma_bossrush_wither")) continue;
            witherHunts.put(wither.getUUID(), new WitherHunt(wither, player.getUUID()));
            if (!player.isCreative() && !player.isSpectator()) wither.setTarget(player);
        }
    }
    private void heavyGravity(ServerPlayer player) {
        player.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SLOWDOWN, 160, 3, false, false));
        heavyPlayers.put(player.getUUID(), ticks + 160);
    }
    private void tickHuntersAndGravity(MinecraftServer server) {
        if (ticks % 2 == 0) for (Iterator<Map.Entry<UUID, Long>> it = heavyPlayers.entrySet().iterator(); it.hasNext();) {
            var entry = it.next(); ServerPlayer player = server.getPlayerList().getPlayer(entry.getKey());
            if (ticks >= entry.getValue() || player == null || !player.isAlive()) { it.remove(); continue; }
            Vec3 v = player.getDeltaMovement();
            player.setDeltaMovement(v.x * 0.45, v.y, v.z * 0.45); player.hurtMarked = true;
            player.connection.send(new ClientboundSetEntityMotionPacket(player));
        }
        if (ticks % 10 == 0) for (Iterator<WitherHunt> it = witherHunts.values().iterator(); it.hasNext();) {
            WitherHunt hunt = it.next(); ServerPlayer player = server.getPlayerList().getPlayer(hunt.player);
            if (!hunt.wither.isAlive() || player == null || !player.isAlive() || player.serverLevel() != hunt.wither.level()
                    || hunt.wither.distanceToSqr(player) > 128 * 128) { it.remove(); continue; }
            if (player.isCreative() || player.isSpectator()) continue;
            hunt.wither.setTarget(player);
            for (int head = 0; head < 3; head++) hunt.wither.setAlternativeTarget(head, player.getId());
        }
    }

    private void motion(ServerPlayer p, double y) {
        p.setOnGround(false);
        p.setDeltaMovement(p.getDeltaMovement().x, y, p.getDeltaMovement().z);
        p.hurtMarked = true;
        p.connection.send(new ClientboundSetEntityMotionPacket(p));
    }
    private void skytrap(ServerPlayer p) {
        jumps.remove(p.getUUID());
        p.removeEffect(MobEffects.SLOW_FALLING); p.removeEffect(MobEffects.LEVITATION);
        int top = p.serverLevel().getHeight(Heightmap.Types.MOTION_BLOCKING, p.getBlockX(), p.getBlockZ());
        if (!p.serverLevel().dimensionType().hasCeiling()) {
            p.teleportTo(p.getX(), Math.min(p.serverLevel().getMaxBuildHeight()-2, top + 85), p.getZ());
            p.fallDistance = 0;
            motion(p, -3.8);
        }
    }
    private void jump(ServerPlayer p, int count) {
        Jump j = jumps.computeIfAbsent(p.getUUID(), id -> new Jump(p));
        if (j.level != p.serverLevel()) { j = new Jump(p); jumps.put(p.getUUID(), j); }
        j.target += JUMP_HEIGHT * (double)count; j.liftY = p.getY(); j.coasting = false; j.age = 0;
        p.removeEffect(MobEffects.JUMP); p.removeEffect(MobEffects.LEVITATION);
        p.addEffect(new MobEffectInstance(MobEffects.SLOW_FALLING, (int)Math.min(120000, Math.max(800, (j.target - p.getY()) * 10 + 400)), 0, false, false));
        p.setOnGround(false);
    }
    private void tickJumps(MinecraftServer server) {
        for (Iterator<Map.Entry<UUID, Jump>> it = jumps.entrySet().iterator(); it.hasNext();) {
            var entry = it.next(); Jump j = entry.getValue(); ServerPlayer p = server.getPlayerList().getPlayer(entry.getKey());
            if (p == null || !p.isAlive() || p.serverLevel() != j.level || (j.age++ > 5 && p.onGround())) { it.remove(); continue; }
            if (!j.coasting) {
                // Drive ascent from the server's trajectory, so latency and packet velocity caps
                // cannot change the promised height. Horizontal steering stays with the player.
                double left = Math.max(0, j.target - j.liftY);
                double step = Math.min(left, Math.min(3.2, Math.max(0.12, JumpPhysics.velocityForHeight(left))));
                j.liftY += step;
                p.teleportTo(p.getX(), j.liftY, p.getZ());
                motion(p, 0);
                p.fallDistance = 0;
                if (j.liftY >= j.target) j.coasting = true;
            }
        }
    }
}
