import { DomainError } from '../../common/errors/domain.error';
import {
  ChatAiPort,
  type AiReplyInput,
  type AiSummaryInput,
  type AiImageInput,
  type AiDebateScoreInput,
  type AiReply,
  type AiSummary,
  type AiImage,
  type AiDebateScore,
} from './chat-ai.port';
export class HttpChatAiAdapter extends ChatAiPort {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {
    super();
  }
  private async call<T>(path: string, body: unknown): Promise<T> {
    try {
      const r = await fetch(`${this.endpoint}/${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error();
      return (await r.json()) as T;
    } catch {
      throw new DomainError(
        'PROVIDER_UNAVAILABLE',
        'AI service is temporarily unavailable',
      );
    }
  }
  reply(i: AiReplyInput) {
    return this.call<AiReply>('reply', i);
  }
  summarize(i: AiSummaryInput) {
    return this.call<AiSummary>('summarize', i);
  }
  generateImage(i: AiImageInput) {
    return this.call<AiImage>('image', i);
  }
  scoreDebate(i: AiDebateScoreInput) {
    return this.call<AiDebateScore>('debate-score', i);
  }
}
