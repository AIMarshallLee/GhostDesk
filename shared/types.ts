export type Scenario = 'service' | 'community' | 'sales' | 'recruitment' | 'content';
export type TaskStatus = 'draft' | 'review' | 'approved' | 'completed' | 'archived';
export interface Knowledge { id: string; title: string; content: string; tags: string[]; enabled: boolean; createdAt: string; updatedAt: string }
export interface Workflow { id: string; name: string; scenario: Scenario; description: string; instructions: string; greeting: string; enabled: boolean; createdAt: string; updatedAt: string }
export interface Task { id: string; title: string; scenario: Scenario; workflowId: string; input: string; reply: string; rationale: string; knowledgeIds: string[]; status: TaskStatus; mode: 'demo' | 'live'; sourceName: string; createdAt: string; updatedAt: string }
export interface AuditEvent { id: string; taskId?: string; action: string; detail: string; createdAt: string }
export interface ProviderSettings { baseUrl: string; model: string; temperature: number; hasKey: boolean }
export interface CustomerLead { id: string; conversationName: string; intent: 'high' | 'medium' | 'low' | 'complaint'; phone?: string; wechatId?: string; budget?: string; painPoint?: string; nextStep?: string; notes?: string; updatedAt: string }
export interface PlaybookPack { id: string; category: string; name: string; description: string; items: Array<{ title: string; content: string; tags: string[] }>; workflow?: { name: string; instructions: string; greeting: string } }
export interface ChatExtractResult { title: string; objection: string; strategy: string; suggestedQa: Array<{ title: string; question: string; answer: string; tags: string[] }>; workflowGuidelines: string[] }

export interface Preferences { workspaceName: string; operatorName: string; collectApprovedLearning?: boolean }
export interface AppState { schemaVersion: number; knowledge: Knowledge[]; workflows: Workflow[]; tasks: Task[]; events: AuditEvent[]; provider: ProviderSettings; preferences: Preferences; learning?: import('./learning').LearningCandidate[]; leads?: CustomerLead[] }
export interface ApiRequest { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; body?: unknown }
export interface CaptureSource { id: string; name: string; thumbnail: string }
export interface CaptureResult { sourceId: string; sourceName: string; image: string; width: number; height: number }
export interface CropRect { x: number; y: number; width: number; height: number }
export interface UsbPort { path: string; label: string; product?: string; manufacturer?: string }
export interface UsbDiscoveryResult { matches: UsbPort[]; autoConnected: boolean; status?: UsbStatus }
export interface UsbStatus { connected: boolean; port?: string; device?: string; firmware?: string; board?: string; protocol?: number; armed: boolean; session?: string; leaseMs?: number; message?: string }
export interface UsbBridge {
  ports(): Promise<UsbPort[]>;
  discover(): Promise<UsbDiscoveryResult>;
  cancelDiscovery(): Promise<void>;
  connect(port: string): Promise<UsbStatus>;
  status(): Promise<UsbStatus>;
  disconnect(): Promise<void>;
  disarm(): Promise<UsbStatus>;
  test(action: 'move' | 'type'): Promise<UsbStatus>;
  pasteTask(taskId: string, sourceId: string): Promise<{ ok: boolean; message: string }>;
}
export interface DesktopBridge {
  media: import('./media').MediaBridge;
  desktopReplies: import('./desktop-replies').DesktopReplyBridge;
  computerUse: import('./computer-use').ComputerUseBridge;
  usb: UsbBridge;
  saveFirmware(): Promise<{ saved: boolean; path?: string }>;
  request(request: ApiRequest): Promise<unknown>;
  sources(): Promise<CaptureSource[]>;
  capture(sourceId: string, crop?: CropRect): Promise<CaptureResult>;
  pasteDraft(taskId: string, sourceId: string): Promise<{ ok: boolean; message: string }>;
  copyText(text: string): Promise<void>;
  version(): Promise<string>;
}
declare global { interface Window { flowdesk?: DesktopBridge } }
