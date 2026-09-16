import type { Scenario } from './types';

export interface LearningSource { taskId: string; title: string; input: string; reply: string; scenario: Scenario }
export interface LearningCandidate {
  id: string; kind: 'knowledge' | 'workflow'; title: string; content: string; scenario: Scenario;
  sources: LearningSource[]; fingerprint: string; method: 'local' | 'model';
  status: 'pending' | 'approved' | 'rejected'; createdAt: string; updatedAt: string; targetId?: string;
}
