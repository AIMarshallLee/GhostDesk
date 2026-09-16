export type ComputerUseMode = 'manual' | 'auto';
export type ComputerUseAction =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'click'; x: number; y: number; button: 'left' | 'right'; count: 1 | 2 }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string }
  | { kind: 'scroll'; x: number; y: number; direction: 'up' | 'down'; amount: number };
export interface ComputerUseTarget { id: string; name: string; kind: 'test' | 'window' }
export interface ComputerUseSettings { baseUrl: string; model: string; modelFamily: 'ui-tars' | 'doubao' | 'gemini'; hasKey: boolean }
export interface ComputerUseSettingsInput { baseUrl: string; model: string; modelFamily: 'ui-tars' | 'doubao' | 'gemini'; apiKey?: string }
export interface ComputerUseStep { index: number; action: string; detail: string; outcome: 'executed' | 'draft' | 'blocked'; at: string }
export interface ComputerUseState {
  runId?: string;
  status: 'idle' | 'running' | 'awaiting_confirmation' | 'completed' | 'stopped' | 'failed' | 'needs_help';
  target?: ComputerUseTarget;
  mode: ComputerUseMode;
  steps: ComputerUseStep[];
  draft: string;
  message: string;
  pendingConfirmation?: { id: string; reason: string; actions: string[] };
}
/** `windows` remains readable for pre-0.6 callers; desktop IPC rejects it and requires Pico USB HID. */
export interface ComputerUseStart { targetId: string; instruction: string; mode: ComputerUseMode; maxSteps: number; allowModel: boolean; knowledgeIds: string[]; inputBackend?: 'windows' | 'usb' }
export interface ComputerUseBridge {
  settings(): Promise<ComputerUseSettings>;
  saveSettings(input: ComputerUseSettingsInput): Promise<ComputerUseSettings>;
  clearKey(): Promise<ComputerUseSettings>;
  openTestTarget(): Promise<ComputerUseTarget>;
  targets(): Promise<ComputerUseTarget[]>;
  state(): Promise<ComputerUseState>;
  start(input: ComputerUseStart): Promise<ComputerUseState>;
  stop(): Promise<ComputerUseState>;
  confirm(input: { id: string; approved: boolean }): Promise<ComputerUseState>;
  copyDraft(): Promise<void>;
}
