export interface AiReplyInput {
  userId: string;
  message: string;
  personality?: string;
  instruction?: string;
}
export interface AiReply {
  text: string;
  provider: string;
  model: string;
  tokens: number;
  responseTimeMs: number;
  confidence: number;
}
export interface AiSummaryInput {
  userId: string;
  messages: readonly string[];
}
export interface AiSummary {
  text: string;
  provider: string;
  tokens: number;
}
export interface AiImageInput {
  userId: string;
  prompt: string;
}
export interface AiImage {
  url: string;
  revisedPrompt?: string;
}
export interface AiDebateScoreInput {
  debateId: string;
  participantId: string;
  message: string;
}
export interface AiDebateScore {
  value: number;
  rationale: string | null;
}
export abstract class ChatAiPort {
  abstract reply(input: AiReplyInput): Promise<AiReply>;
  abstract summarize(input: AiSummaryInput): Promise<AiSummary>;
  abstract generateImage(input: AiImageInput): Promise<AiImage>;
  abstract scoreDebate(input: AiDebateScoreInput): Promise<AiDebateScore>;
}
