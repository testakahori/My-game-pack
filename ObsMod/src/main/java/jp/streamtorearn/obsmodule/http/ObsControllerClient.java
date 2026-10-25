package jp.streamtorearn.obsmodule.http;

import jp.streamtorearn.obsmodule.ObsBridgeMod;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

public final class ObsControllerClient {
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofMillis(250)).build();
    private final AtomicInteger inFlight=new AtomicInteger();
    private volatile String endpoint="http://127.0.0.1:3000/event";
    // 送るかは obs-send.properties で決める（ObsSendSettings）。はじめはオフ（MyGamePack に同梱した OBSMOD の既定。2026-10-25）。
    private volatile boolean enabled=false;
    public void setEndpoint(String e){if(e!=null&&!e.isBlank())endpoint=e;}
    public void setEnabled(boolean on){enabled=on;}
    public boolean enabled(){return enabled;}

    public void postAsync(String json){
        if(!enabled)return;
        if(inFlight.incrementAndGet()>32){inFlight.decrementAndGet();ObsBridgeMod.LOGGER.warn("OBSMOD HTTP queue full; event dropped");return;}
        try{
            HttpRequest req=HttpRequest.newBuilder(URI.create(endpoint)).timeout(Duration.ofMillis(500)).header("Content-Type","application/json; charset=utf-8").POST(HttpRequest.BodyPublishers.ofString(json)).build();
            client.sendAsync(req,HttpResponse.BodyHandlers.discarding()).whenComplete((r,e)->{inFlight.decrementAndGet();if(e!=null)ObsBridgeMod.LOGGER.warn("OBSTool event send failed: {}",e.toString());});
        }catch(Exception e){inFlight.decrementAndGet();ObsBridgeMod.LOGGER.warn("OBSTool event send rejected: {}",e.toString());}
    }
    public void healthAsync(){
        if(!enabled)return;
        try{ URI u=URI.create(endpoint).resolve("/health"); HttpRequest req=HttpRequest.newBuilder(u).timeout(Duration.ofMillis(500)).GET().build(); client.sendAsync(req,HttpResponse.BodyHandlers.discarding()).exceptionally(e->null); }catch(Exception ignored){}
    }
}
