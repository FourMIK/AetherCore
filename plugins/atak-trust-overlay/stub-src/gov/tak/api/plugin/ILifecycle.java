package gov.tak.api.plugin;

import android.content.res.Configuration;

/**
 * Stub for ATAK ILifecycle
 */
public interface ILifecycle {
    void onCreate(IServiceController delegate);
    void onStart();
    void onResume();
    void onPause();
    void onStop();
    void onDestroy();
    void onConfigurationChanged(Configuration newConfig);
}

