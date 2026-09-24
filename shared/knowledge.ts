import type { Knowledge, Scenario } from './types';

export const KNOWLEDGE_IMPORT_LIMITS = { files: 5, fileBytes: 8 * 1024 * 1024, base64Characters: 12 * 1024 * 1024, rows: 300, extractedCharacters: 500000 };
export type KnowledgeDraft = Pick<Knowledge, 'title' | 'content' | 'tags' | 'question' | 'aliases' | 'scenario' | 'source' | 'sourceLocator'>;
export interface KnowledgeImportFile { name: string; size: number; base64: string }
export interface KnowledgeImportInput { files?: KnowledgeImportFile[]; text?: string; textKind?: 'document' | 'chat'; sourceName?: string }
export interface KnowledgeImportRow extends KnowledgeDraft { rowId: string; errors: string[]; duplicateOf?: string }
export interface KnowledgeImportPreview { previewId: string; expiresAt: string; rows: KnowledgeImportRow[]; warnings: string[] }
export interface KnowledgeImportCommit { previewId: string; rows: Array<Omit<KnowledgeDraft, 'source' | 'sourceLocator'> & { rowId: string }>; confirm: true }
export interface KnowledgeHit { id: string; title: string; content: string; question?: string; source?: string; sourceLocator?: string; score: number; matchedTerms: string[]; matchedFields: string[] }
export interface KnowledgeSearchInput { query: string; scenario?: Scenario | 'all'; ids?: string[] }
export interface KnowledgeSearchResult { query: string; hits: KnowledgeHit[]; status: 'matched' | 'no_match'; note: string }
export interface KnowledgeEvaluationInput { cases: Array<{ question: string; expectedTitle?: string }>; scenario?: Scenario | 'all' }
export interface KnowledgeEvaluationResult { total: number; matched: number; passed: number; results: Array<KnowledgeSearchResult & { expectedTitle?: string; passed: boolean }> }
