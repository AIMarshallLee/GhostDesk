import type { ComputerUseTarget } from './computer-use';
export interface NormalizedRect { x: number; y: number; width: number; height: number }
export interface ReplyLayout {
  conversations: NormalizedRect; header: NormalizedRect; messages: NormalizedRect;
  composer: NormalizedRect; send: NormalizedRect;
}
export interface ReplyConversation { id: string; name: string; enabled: boolean }
export type ReplyModelProtocol = 'gemini-native' | 'openai-vision';
export interface DesktopReplyConfig {
  modelProtocol?: ReplyModelProtocol;
  conversations: ReplyConversation[]; layout: ReplyLayout; mode: 'manual' | 'auto';
  /** Legacy persisted `windows` remains readable so the UI can explicitly migrate it to USB before saving. */
  pollSeconds: number; maxRepliesPerHour: number; knowledgeIds: string[]; workflowId: string; inputBackend?: 'windows' | 'usb';
  humanDelay?: boolean; splitBubbles?: boolean;
}
export interface VisibleChatMessage { direction: 'incoming' | 'outgoing'; text: string; stamp: string }
export interface ChatObservation {
  conversationName: string; messages: VisibleChatMessage[]; composerText: string; observedAt: string;
}
export interface DesktopReplyJob {
  id: string; conversationId: string; conversationName: string; input: string; reply: string;
  status: 'queued' | 'generating' | 'ready' | 'copied' | 'sending' | 'visually_confirmed' | 'uncertain' | 'handoff' | 'failed';
  observation: ChatObservation; attempts: number; createdAt: string; updatedAt: string; detail: string;
  knowledgeIds: string[]; knowledgeHash: string; mode: 'manual' | 'auto';
}
export interface DesktopReplyState {
  version: 1; config: DesktopReplyConfig; target?: ComputerUseTarget;
  status: 'stopped' | 'running' | 'paused' | 'needs_attention';
  message: string; busy: boolean; cycle: number; lastScanAt?: string; nextScanAt?: string;
  jobs: DesktopReplyJob[]; checkpoints: Record<string, ChatObservation>;
  events: Array<{ at: string; type: string; detail: string }>;
}
export interface DesktopReplyStart { targetId: string; allowModel: boolean }
export interface DesktopReplyBridge {
  state(): Promise<DesktopReplyState>;
  saveConfig(config: DesktopReplyConfig): Promise<DesktopReplyState>;
  start(input: DesktopReplyStart): Promise<DesktopReplyState>;
  pause(): Promise<DesktopReplyState>; stop(): Promise<DesktopReplyState>;
  takeover(conversationId: string, enabled: boolean): Promise<DesktopReplyState>;
  copy(jobId: string): Promise<void>; resolve(jobId: string): Promise<DesktopReplyState>;
  preview(targetId: string): Promise<{ image: string; width: number; height: number }>;
  openTestTarget(): Promise<ComputerUseTarget>;
  provider(protocol?: ReplyModelProtocol): Promise<{ configured: boolean; baseUrl: string; model: string }>;
  exportReport(): Promise<string>;
}
export const defaultReplyLayout: ReplyLayout = {
  conversations: { x: 0, y: .1, width: .25, height: .65 },
  header: { x: .26, y: .08, width: .70, height: .11 },
  messages: { x: .26, y: .20, width: .70, height: .48 },
  composer: { x: .28, y: .73, width: .65, height: .14 },
  send: { x: .81, y: .89, width: .14, height: .08 },
};
