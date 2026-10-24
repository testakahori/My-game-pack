package jp.streamtorearn.stackinggame.world;

import com.google.gson.*;
import jp.streamtorearn.stackinggame.StackingGameMod;
import jp.streamtorearn.stackinggame.event.EventTargetMode;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.LevelResource;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public final class TemporaryBlockManager {
    private static final Gson GSON=new GsonBuilder().setPrettyPrinting().create();
    private final BlockSafetyService safety;

    public TemporaryBlockManager(BlockSafetyService safety) {
        this.safety = safety;
    }
    private final Map<UUID,LinkedHashMap<BlockRef,Entry>> byRequest=new LinkedHashMap<>(); private boolean dirty; private long lastFlush=-1000;
    private record BlockRef(String dimension,long pos){}
    private record Entry(BlockState restore,BlockState temporary){}

    public boolean place(UUID requestId,ServerLevel level,BlockPos pos,BlockState temporary, EventTargetMode targetMode){
        return place(requestId,level,pos,temporary,level.getBlockState(pos),targetMode);
    }
    public boolean place(UUID requestId,ServerLevel level,BlockPos pos,BlockState temporary,BlockState restore, EventTargetMode targetMode){
        if(!safety.canPlaceTemporary(level,pos,targetMode))return false;
        BlockRef ref=new BlockRef(level.dimension().location().toString(),pos.asLong());
        LinkedHashMap<BlockRef,Entry> map=byRequest.computeIfAbsent(requestId,k->new LinkedHashMap<>());
        map.putIfAbsent(ref,new Entry(restore,temporary));
        level.setBlock(pos,temporary,3);dirty=true;return true;
    }
    public void restoreRequest(MinecraftServer server,UUID requestId){
        LinkedHashMap<BlockRef,Entry> map=byRequest.get(requestId);
        if(map==null)return;
        Iterator<Map.Entry<BlockRef,Entry>> it=map.entrySet().iterator();
        int restoredOrResolved=0;
        int pending=0;
        while(it.hasNext()){
            Map.Entry<BlockRef,Entry> e=it.next();
            if(restoreOne(server,e.getKey(),e.getValue())){
                it.remove();
                restoredOrResolved++;
            }else{
                pending++;
            }
        }
        if(map.isEmpty())byRequest.remove(requestId);
        dirty=true;
        // END/CANCEL直後にクラッシュしても未復元情報を失わないよう、その場でrecovery.jsonへ反映する。
        flush(server,true);
        if(pending>0){
            StackingGameMod.LOGGER.warn(
                    "Temporary blocks remain pending after cleanup: requestId={} pending={} resolved={}",
                    requestId,pending,restoredOrResolved);
        }
    }
    public void restoreAll(MinecraftServer server){for(UUID id:new ArrayList<>(byRequest.keySet()))restoreRequest(server,id);flush(server,true);}    
    public int count(UUID requestId){
        LinkedHashMap<BlockRef,Entry> map=byRequest.get(requestId);
        return map==null?0:map.size();
    }
    /** true=復元済み/別処理で変更済みのため管理終了、false=未ロード等で後日再試行。 */
    private boolean restoreOne(MinecraftServer server,BlockRef ref,Entry e){
        ServerLevel level=level(server,ref.dimension);
        if(level==null)return false;
        BlockPos pos=BlockPos.of(ref.pos);
        if(!level.hasChunkAt(pos))return false;
        BlockState current=level.getBlockState(pos);
        if(current.equals(e.temporary))level.setBlock(pos,e.restore,3);
        // temporary以外なら利用者操作/別処理で変更済み。上書きせず管理終了。
        return true;
    }

    public void tick(MinecraftServer server,long tick){if(dirty&&tick-lastFlush>=20)flush(server,false);}
    public void loadAndRestore(MinecraftServer server){
        Path f=file(server);
        if(!Files.exists(f))return;
        try{
            JsonArray source=JsonParser.parseString(Files.readString(f,StandardCharsets.UTF_8)).getAsJsonArray();
            JsonArray pending=new JsonArray();
            int restored=0;
            int unresolved=0;
            for(JsonElement je:source){
                JsonObject o=je.getAsJsonObject();
                ServerLevel level=level(server,o.get("dimension").getAsString());
                if(level==null){
                    pending.add(je.deepCopy());
                    unresolved++;
                    continue;
                }
                BlockPos pos=BlockPos.of(o.get("pos").getAsLong());
                // 再起動直後に未ロードchunkを無理に読み込まない。復旧情報だけ残して次回へ回す。
                if(!level.hasChunkAt(pos)){
                    pending.add(je.deepCopy());
                    unresolved++;
                    continue;
                }
                BlockState temp=BlockStateJsonCodec.decode(o.getAsJsonObject("temporary"));
                if(level.getBlockState(pos).equals(temp)){
                    level.setBlock(pos,BlockStateJsonCodec.decode(o.getAsJsonObject("restore")),3);
                    restored++;
                }
                // 現在値がtemporary以外なら、別処理/利用者操作で既に変わったと判断して上書きせず解決済みにする。
            }
            if(pending.size()==0){
                Files.deleteIfExists(f);
            }else{
                Files.writeString(f,GSON.toJson(pending),StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING);
            }
            StackingGameMod.LOGGER.info(
                    "Temporary block recovery: restored={} pending={} total={}",
                    restored, unresolved, source.size());
        }catch(Exception ex){
            // 読み込み/復元に失敗した場合はファイルを削除しない。次回起動時に再試行できるよう残す。
            StackingGameMod.LOGGER.error("Failed to restore recovery.json; recovery file was kept",ex);
        }
    }
    public void flush(MinecraftServer server,boolean force){ if(!dirty&&!force)return; try{Path f=file(server);Files.createDirectories(f.getParent());JsonArray a=new JsonArray();for(var map:byRequest.values())for(var e:map.entrySet()){JsonObject o=new JsonObject();o.addProperty("dimension",e.getKey().dimension);o.addProperty("pos",e.getKey().pos);o.add("restore",BlockStateJsonCodec.encode(e.getValue().restore));o.add("temporary",BlockStateJsonCodec.encode(e.getValue().temporary));a.add(o);}Files.writeString(f,GSON.toJson(a),StandardCharsets.UTF_8,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING);dirty=false;lastFlush=server.getTickCount();}catch(Exception ex){StackingGameMod.LOGGER.error("Failed to write recovery.json",ex);} }
    private Path file(MinecraftServer server){return server.getWorldPath(LevelResource.ROOT).resolve("stackinggame").resolve("recovery.json");}
    private ServerLevel level(MinecraftServer server,String id){try{return server.getLevel(ResourceKey.create(Registries.DIMENSION,new ResourceLocation(id)));}catch(Exception e){return null;}}
}
