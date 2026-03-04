package com.atakmap.comms;

/**
 * Minimal stub for ATAK CotServiceRemote - used for compilation only
 */
public class CotServiceRemote {
    public interface CotEventListener {
        void onCotEvent(com.atakmap.coremap.cot.event.CotEvent event, android.os.Bundle bundle);
    }

    public interface ConnectionListener {
        void onCotServiceConnected();
        void onCotServiceDisconnected();
    }

    public static CotServiceRemote getInstance() {
        return null;
    }

    public void addCotEventListener(CotEventListener listener) {}
    public void removeCotEventListener(CotEventListener listener) {}
    
    // Added for Tactical Glass plugin compatibility
    public void setCotEventListener(CotEventListener listener) {}
}

