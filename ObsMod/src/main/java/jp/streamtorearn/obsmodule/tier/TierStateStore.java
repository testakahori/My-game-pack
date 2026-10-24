package jp.streamtorearn.obsmodule.tier;

import java.util.concurrent.ConcurrentHashMap;

public final class TierStateStore {
    private final ConcurrentHashMap<String,String> tiers=new ConcurrentHashMap<>(); private volatile String defaultTier="normal";
    public void reset(String d){tiers.clear();defaultTier=(d==null||d.isBlank())?"normal":d;}
    public void put(String encounterKey,String tier){if(encounterKey!=null&&!encounterKey.isBlank())tiers.put(encounterKey,(tier==null||tier.isBlank())?defaultTier:tier);}
    public String consume(String encounterKey,String fallback){String t=tiers.remove(encounterKey);return t==null?((fallback==null||fallback.isBlank())?defaultTier:fallback):t;}
}
