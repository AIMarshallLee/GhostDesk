export const MEDIA_LIMITS = { fileBytes: 8 * 1024 * 1024, base64Characters: 12 * 1024 * 1024, files: 4 };
export const MEDIA_EXTENSIONS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain' } as const;
export interface MediaFile { name: string; mimeType: string; size: number; base64: string }
export interface MediaAnalyzeInput { files: MediaFile[]; question: string; knowledgeIds: string[]; allowModel: true }
export interface MediaAnalysis { resultId: string; extracted: string; draft: string; uncertainties: string; files: Array<Pick<MediaFile, 'name' | 'mimeType' | 'size'>>; knowledgeIds: string[] }
export interface MediaSaveInput { resultId: string; title: string; transcript: string; reply: string }
export interface MediaBridge { save(input: MediaSaveInput): Promise<{ id: string }>;  analyze(input: MediaAnalyzeInput): Promise<MediaAnalysis>; stop(): Promise<void> }
