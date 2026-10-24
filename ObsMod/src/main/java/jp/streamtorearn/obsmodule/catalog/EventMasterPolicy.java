package jp.streamtorearn.obsmodule.catalog;

/** Runtime policy helpers layered on top of generated EventMaster data. */
public final class EventMasterPolicy {
    private EventMasterPolicy() {}

    public static boolean isCandidateGift(String key) {
        EventMaster.Gift gift = EventMaster.SIMPLE_GIFTS.get(key);
        return gift != null && "candidate".equalsIgnoreCase(gift.status());
    }

    public static String implementationStatus(String key) {
        EventMaster.Gift gift = EventMaster.SIMPLE_GIFTS.get(key);
        if (gift != null) return gift.status();
        if (EventMaster.STACKING_STARTS.containsKey(key) || EventMaster.ENCOUNTERS.containsKey(key)) return "implemented";
        return "unknown";
    }

    public static String category(String key) {
        EventMaster.Gift gift = EventMaster.SIMPLE_GIFTS.get(key);
        return gift == null ? "" : gift.category();
    }
}
