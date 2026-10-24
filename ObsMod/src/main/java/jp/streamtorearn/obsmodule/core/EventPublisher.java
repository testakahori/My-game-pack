package jp.streamtorearn.obsmodule.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import jp.streamtorearn.obsmodule.http.ObsControllerClient;
import java.util.LinkedHashMap;
import java.util.Map;

public final class EventPublisher {
    private static final Gson GSON=new GsonBuilder().create(); private final ObsControllerClient http;
    public EventPublisher(ObsControllerClient http){this.http=http;}
    public void publish(String eventType,String eventKey,Map<String,Object> extra){ Map<String,Object> p=new LinkedHashMap<>();p.put("eventType",eventType);p.put("eventKey",eventKey);p.put("timestamp",System.currentTimeMillis());if(extra!=null)p.putAll(extra);http.postAsync(GSON.toJson(p)); }
}
