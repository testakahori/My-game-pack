package jp.streamtorearn.stackinggame.lab;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.saveddata.SavedData;

/** ログアウト・サーバー停止でも帰還先と復元の必要性を失わない。 */
public final class LabSavedData extends SavedData {
    public record Home(double x, double z, float yaw, float pitch) {}
    public final Map<UUID, Home> homes = new LinkedHashMap<>();
    public boolean needsRestore;
    public static LabSavedData get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(LabSavedData::load, LabSavedData::new, "umetate_lab_events");
    }
    private static LabSavedData load(CompoundTag tag) {
        LabSavedData data = new LabSavedData();
        data.needsRestore = tag.getBoolean("NeedsRestore");
        for (Tag entry : tag.getList("Homes", Tag.TAG_COMPOUND)) {
            CompoundTag home = (CompoundTag) entry;
            if (home.hasUUID("Player")) data.homes.put(home.getUUID("Player"),
                    new Home(home.getDouble("X"), home.getDouble("Z"), home.getFloat("Yaw"), home.getFloat("Pitch")));
        }
        return data;
    }
    @Override public CompoundTag save(CompoundTag tag) {
        tag.putBoolean("NeedsRestore", needsRestore);
        ListTag list = new ListTag();
        homes.forEach((id, home) -> {
            CompoundTag item = new CompoundTag();
            item.putUUID("Player", id); item.putDouble("X", home.x()); item.putDouble("Z", home.z());
            item.putFloat("Yaw", home.yaw()); item.putFloat("Pitch", home.pitch()); list.add(item);
        });
        tag.put("Homes", list);
        return tag;
    }
    public void flush(ServerLevel level) {
        setDirty();
        level.getDataStorage().save();
    }
}
