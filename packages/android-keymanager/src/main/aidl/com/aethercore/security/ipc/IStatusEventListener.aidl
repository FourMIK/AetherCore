package com.aethercore.security.ipc;

import android.os.Bundle;

interface IStatusEventListener {
    void onStatusEvent(in Bundle statusEvent);
    void onSnapshotEvent(in Bundle snapshotEvent);
}
