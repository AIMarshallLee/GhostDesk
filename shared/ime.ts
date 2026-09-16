/** Read-only visual transcription of the focused editor and its IME candidate window. */
export interface ImeScene {
  focused: boolean;
  field: { x: number; y: number; width: number; height: number };
  text: string;
  composition: string;
  candidates: Array<{ key: string; text: string }>;
  confidence: number;
  blocked: boolean;
}
