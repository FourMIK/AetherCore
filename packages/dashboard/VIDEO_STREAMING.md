# ISR Console Video Streaming

## Overview

The ISR Console now supports format-agnostic video streaming from field nodes. The system automatically detects the video format (HLS, MJPEG, WebRTC, or Mock FLIR) and displays the appropriate player.

## Features

### Supported Video Formats

- **HLS (HTTP Live Streaming)**: Industry-standard adaptive streaming format
- **MJPEG (Motion JPEG)**: Simple frame-by-frame JPEG streaming
- **WebRTC**: Real-time peer-to-peer video communication (coming soon)
- **Mock FLIR**: Simulated thermal imaging for demonstration and testing

### Automatic Format Detection

The `AgnosticVideoPlayer` component automatically detects the stream format and renders the appropriate player with no configuration required.

### Real-time Status Monitoring

- Live connection indicators
- Connecting/offline states with visual feedback
- Stream metadata display (resolution, FPS, codec, bitrate)

## Usage

### Adding Video Stream to a Node

To add a video stream to a tactical node, include the `videoStream` property:

```typescript
import { TacticalNode, VideoStream } from '@aethercore/dashboard';

const nodeWithVideo: TacticalNode = {
  id: 'node-001',
  domain: 'isr-domain',
  position: { latitude: 40.7128, longitude: -74.0060 },
  trustScore: 0.95,
  verified: true,
  lastSeen: new Date(),
  status: 'online',
  videoStream: {
    url: 'http://192.168.1.100:5000/stream',
    format: 'mock-flir',  // or 'hls', 'mjpeg', 'webrtc'
    status: 'live',
    resolution: '640x480',
    metadata: {
      fps: 30,
      bitrate: 5000,
      codec: 'h264',
    },
  },
};
```

### Using the AgnosticVideoPlayer Component

```typescript
import { AgnosticVideoPlayer } from '@/components/media';
import { VideoStream } from '@/types';

const stream: VideoStream = {
  url: 'http://example.com/stream.m3u8',
  format: 'hls',
  status: 'live',
  resolution: '1920x1080',
};

function MyComponent() {
  return (
    <AgnosticVideoPlayer
      stream={stream}
      onError={(error) => {
        console.error('Stream error:', error);
      }}
    />
  );
}
```

## Integration with FLIR Trust Bridge

The video streaming capability is designed to work seamlessly with the FLIR Trust Bridge integration:

1. **FLIR Device Setup**: Configure FLIR Nexus camera to stream telemetry and video
2. **Node Configuration**: Add FLIR stream to tactical node's `videoStream` property
3. **Automatic Display**: ISR Console automatically displays video when node is selected

Example FLIR integration:

```typescript
const flirNode: TacticalNode = {
  id: 'flir-001',
  domain: 'isr-domain',
  position: { latitude: 35.6762, longitude: 139.6503 },
  trustScore: 0.98,
  verified: true,
  lastSeen: new Date(),
  status: 'online',
  videoStream: {
    url: 'http://192.168.1.100:5000/mjpeg',
    format: 'mjpeg',  // FLIR typically uses MJPEG
    status: 'live',
    resolution: '640x480',
    metadata: {
      fps: 30,
      codec: 'mjpeg',
    },
  },
};
```

## ISR Console Behavior

### Node Selection

When a node is selected in the Tactical Map:
1. ISR Console checks if the node has a `videoStream` property
2. If present, the video player is automatically displayed
3. Stream metadata is shown below the player
4. Active feed count is updated in the Visual Intelligence panel

### No Video Available

When a node without video is selected, the console displays:
- "No video stream available for selected node"
- Helpful message explaining the node lacks ISR capabilities

### Mock FLIR Demonstration

For testing and demonstration purposes, use the `mock-flir` format:

```typescript
videoStream: {
  url: '#',  // URL not used for mock streams
  format: 'mock-flir',
  status: 'live',
  resolution: '640x480',
}
```

This displays a simulated thermal imaging feed with:
- Animated thermal gradient
- FLIR-style HUD overlay
- Temperature readings
- Recording indicator
- Timestamp and resolution display
- Crosshair reticle

## Architecture

### Type Definitions

```typescript
export interface VideoStream {
  url: string;
  format: 'hls' | 'webrtc' | 'mjpeg' | 'mock-flir';
  status: 'live' | 'offline' | 'connecting';
  resolution?: string;
  metadata?: {
    fps?: number;
    bitrate?: number;
    codec?: string;
  };
}
```

### Component Hierarchy

```
ISRConsoleView
├── Visual Intelligence Panel (active feed count)
├── Signal Intelligence Panel
└── Reconnaissance Feed Panel
    ├── AgnosticVideoPlayer (when video available)
    │   ├── HLS Player (for HLS streams)
    │   ├── MJPEG Player (for MJPEG streams)
    │   ├── WebRTC Player (for WebRTC streams)
    │   └── Mock FLIR Player (for demonstrations)
    └── Stream Information Panel
```

## Error Handling

The video player includes comprehensive error handling:

- **Connection Failures**: Displays "Connecting..." overlay
- **Stream Offline**: Shows offline indicator with error message
- **Format Unsupported**: Falls back to error state with helpful message
- **Network Issues**: Gracefully handles intermittent connectivity

## Future Enhancements

### Planned Features

- [ ] WebRTC full implementation with signaling server
- [ ] Multi-stream support (picture-in-picture for multiple nodes)
- [ ] Video recording and playback
- [ ] Stream quality adaptation
- [ ] Bandwidth monitoring and optimization
- [ ] Advanced FLIR thermal imaging controls
- [ ] AI-powered object detection overlays

## Testing

Run the video streaming type tests:

```bash
npm test -- videostream-types.test.ts
```

## Security Considerations

- All video streams should use HTTPS in production
- Implement proper authentication for video feeds
- Consider bandwidth limitations in contested environments
- Validate stream URLs to prevent injection attacks
- Apply proper CORS policies for cross-origin streams

## Performance

The video player is optimized for:
- Low latency in tactical environments
- Minimal CPU usage
- Adaptive quality based on network conditions
- Efficient memory management
- Hardware acceleration where available

## Troubleshooting

### Video not displaying

1. Check that the node has a `videoStream` property
2. Verify the stream URL is accessible
3. Ensure the format matches the actual stream type
4. Check browser console for errors

### Poor video quality

1. Check network bandwidth and latency
2. Verify stream bitrate settings
3. Consider using adaptive streaming (HLS)
4. Check for packet loss in the mesh network

### Stream keeps connecting

1. Verify the video server is running
2. Check firewall and network routing
3. Ensure proper CORS headers on the server
4. Validate authentication if required
