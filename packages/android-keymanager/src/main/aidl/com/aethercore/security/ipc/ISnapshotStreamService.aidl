package com.aethercore.security.ipc;

import android.os.Bundle;
import com.aethercore.security.ipc.IStatusEventListener;

interface ISnapshotStreamService {
    void registerListener(IStatusEventListener listener);
    void unregisterListener(IStatusEventListener listener);
    void publishSnapshot(in Bundle snapshotPayload);
}
