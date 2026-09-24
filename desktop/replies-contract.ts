import type { ChatObservation, DesktopReplyConfig, ReplyConversation, VisibleChatMessage } from '../shared/desktop-replies';
import type { ComputerUseTarget } from '../shared/computer-use';

/** A new message arrived while the surface was establishing a stable checkpoint. */
export class TransientChatChange extends Error {
  constructor() {
    super('会话消息正在变化，等待下一次稳定观察。');
    this.name = 'TransientChatChange';
  }
}

export interface DesktopChatSurface {
  target: ComputerUseTarget;
  open(signal: AbortSignal): Promise<void>;
  observe(conversation: ReplyConversation, signal: AbortSignal): Promise<ChatObservation>;
  deliver(conversation: ReplyConversation, expected: ChatObservation, reply: string, signal: AbortSignal):
    Promise<{ status: 'visually_confirmed' | 'uncertain' | 'stale'; observation?: ChatObservation }>;
  close(): void | Promise<void>;
}
export interface ReplyGenerationInput {
  conversation: ReplyConversation; incoming: VisibleChatMessage[]; history: VisibleChatMessage[];
  knowledge: string; instructions: string;
}
export interface DesktopRepliesDependencies {
  directory: string;
  createSurface(targetId: string, config: DesktopReplyConfig): Promise<DesktopChatSurface>;
  context(config: DesktopReplyConfig, query?: string): Promise<{ knowledge: string; instructions: string; knowledgeIds?: string[] }>;
  generate(input: ReplyGenerationInput, signal: AbortSignal): Promise<string>;
  onIncomingLead?: (conversationName: string, text: string) => Promise<unknown> | void;
  onReplyDelivered?: (conversationName: string, reply: string) => Promise<unknown> | void;
  onHandoff?: (conversationName: string, detail: string) => Promise<unknown> | void;
  now?: () => number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout;
}
