// Global type declarations for build-time constants injected by Vite

/** Build environment - 'dev' or 'prod' */
declare const __ENV__: 'dev' | 'prod' | undefined;

/** App version from package.json */
declare const __APP_VERSION__: string;

// WebCodecs API types (for video decoding)
interface VideoDecoder {
  state: 'unconfigured' | 'configured' | 'closed';
  configure(config: VideoDecoderConfig): void;
  decode(chunk: EncodedVideoChunk): void;
  reset(): void;
  close(): void;
}

interface VideoDecoderConfig {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  description?: BufferSource;
  optimizeForLatency?: boolean;
  hardwareAcceleration?: 'prefer-hardware' | 'prefer-software' | 'no-preference';
}

interface EncodedVideoChunk {
  type: 'key' | 'delta';
  timestamp: number;
  duration?: number;
  data: BufferSource;
  byteOffset?: number;
  byteLength?: number;
}

interface VideoFrame {
  format: VideoPixelFormat | null;
  codedWidth: number;
  codedHeight: number;
  codedRect: DOMRectReadOnly | null;
  visibleRect: DOMRectReadOnly | null;
  displayWidth: number;
  displayHeight: number;
  duration: number | null;
  timestamp: number;
  colorSpace: VideoColorSpace;
  close(): void;
}

type VideoPixelFormat = 'I420' | 'I422' | 'I444' | 'NV12' | 'RGBA' | 'RGBX' | 'BGRA' | 'BGRX';

interface VideoColorSpace {
  primaries: VideoColorPrimaries | null;
  transfer: VideoTransferCharacteristics | null;
  matrix: VideoMatrixCoefficients | null;
  fullRange: boolean | null;
}

type VideoColorPrimaries = 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020' | 'smpte432';
type VideoTransferCharacteristics = 'bt709' | 'smpte170m' | 'iec61966-2-1' | 'linear' | 'pq' | 'hlg';
type VideoMatrixCoefficients = 'rgb' | 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020-ncl';

declare var VideoDecoder: {
  new (init: {
    output: (frame: VideoFrame) => void;
    error: (error: Error) => void;
  }): VideoDecoder;
  isConfigSupported(config: VideoDecoderConfig): Promise<VideoDecoderSupport>;
};

interface VideoDecoderSupport {
  supported: boolean;
  config: VideoDecoderConfig;
}
