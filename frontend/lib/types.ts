export type PipelineState = "loading_model" | "connecting" | "running" | "paused" | "error";

export interface BackendError {
  code:
    | "camera_unavailable"
    | "source_not_found"
    | "source_unreadable"
    | "source_ended"
    | "model_error"
    | "inference_error"
    | string;
  message: string;
}

export interface StatusMessage {
  type: "status";
  state: PipelineState;
  paused: boolean;
  error: BackendError | null;
  model: string;
  device: string | null;
  source: number | string;
  source_kind: "camera" | "file";
  config: { confidence: number; imgsz: number };
}

export interface Detection {
  /** [x1, y1, x2, y2], normalized 0-1 */
  bbox: [number, number, number, number];
  confidence: number;
}

export interface Stats {
  raw_count: number;
  smoothed_count: number;
  peak_count: number;
  avg_60s: number;
  fps: number;
  inference_ms: number;
  frames_processed: number;
}

export interface FrameMessage {
  type: "frame";
  ts: number;
  frame: { jpeg: string; width: number; height: number };
  detections: Detection[];
  stats: Stats;
}

export type ServerMessage = StatusMessage | FrameMessage;

export interface CameraInfo {
  index: number;
  label: string;
  active: boolean;
}

export interface BackendConfig {
  source: number | string;
  confidence: number;
  imgsz: number;
  imgsz_options: number[];
  model: string;
  device: string | null;
}

export type ConnectionState = "connecting" | "open" | "unreachable";

export interface HistoryPoint {
  t: number; // ms epoch
  v: number;
}
