import { createParser } from 'eventsource-parser';
import type { ServiceError } from '@bob-translate/types';
import { apiError, asError, checkFinish, objectData, providerError, translationText } from './api';

const MAX_BUFFER_LENGTH = 1024 * 1024;

export class TranslationStream {
  private rawText = '';
  private rawResponse: string | undefined = '';
  private eventSize = 0;
  private line = '';
  private firstChunk = true;
  private skipLF = false;
  private ended = false;
  private stopped = false;
  private error?: ServiceError;
  private previous = '';
  private readonly parser = createParser({
    onEvent: (event) => {
      if (this.error || this.ended) return;
      if (event.data === '[DONE]') { this.ended = true; return; }
      if (!event.data) return;
      try {
        const data = objectData(event.data);
        const error = providerError(data);
        if (error) throw error;
        if (!Array.isArray(data.choices) || !data.choices.length) return;
        const choice = objectData(data.choices[0]);
        checkFinish(choice.finish_reason, this.maxTokens);
        if (choice.finish_reason === 'stop') this.stopped = true;
        const delta = choice.delta ? objectData(choice.delta) : {};
        if (typeof delta.content !== 'string') return;
        this.rawText += delta.content;
        const text = translationText(this.rawText);
        if (text && text !== this.previous) { this.previous = text; this.onText(text); }
      } catch (error) { this.error = asError(error); }
    },
  });

  constructor(private readonly onText: (text: string) => void, private readonly maxTokens?: number) {}

  feed(text: string): void {
    if (this.error || this.ended || !text) return;
    // Bob supplies decoded strings. Empty callbacks must not consume the BOM check.
    if (this.firstChunk) {
      this.firstChunk = false;
      if (text.startsWith('\uFEFF')) text = text.slice(1);
      if (!text) return;
    }
    // Retain only a plain JSON error body, not the entire SSE wire response.
    if (this.rawResponse !== undefined) {
      const candidate = this.rawResponse + text;
      const prefix = candidate.trimStart();
      if (prefix && !prefix.startsWith('{')) this.rawResponse = undefined;
      else if (candidate.length > MAX_BUFFER_LENGTH) {
        this.error = apiError('API 流式响应过大'); return;
      } else this.rawResponse = candidate;
    }
    // Feed complete, normalized lines so the guard measures one unfinished event,
    // regardless of how Bob groups network chunks. CRLF can span callbacks.
    const endings = /[\r\n]/g;
    let start = 0;
    let match: RegExpExecArray | null;
    while ((match = endings.exec(text))) {
      const index = match.index;
      if (index > start) this.skipLF = false;
      if (this.skipLF && match[0] === '\n') {
        this.skipLF = false;
        start = index + 1;
        continue;
      }
      if (!this.appendLine(text.slice(start, index))) return;
      const line = this.line;
      this.line = '';
      // Comments do not add to the parser's event buffer; blank lines reset it.
      if (!line) this.eventSize = 0;
      else if (!line.startsWith(':')) this.eventSize += line.length + 1;
      if (this.eventSize > MAX_BUFFER_LENGTH) {
        this.error = apiError('API 流式响应过大'); return;
      }
      this.parser.feed(line + '\n');
      if (this.error || this.ended) return;
      this.skipLF = match[0] === '\r';
      start = index + 1;
    }
    if (start < text.length) {
      this.skipLF = false;
      this.appendLine(text.slice(start));
    }
  }

  private appendLine(text: string): boolean {
    if (this.eventSize + this.line.length + text.length > MAX_BUFFER_LENGTH) {
      this.error = apiError('API 流式响应过大'); return false;
    }
    this.line += text;
    return true;
  }

  finish(): string {
    if (this.error) throw this.error;
    if (this.line && !this.ended) this.parser.feed(this.line);
    this.parser.reset({ consume: true });
    if (this.rawResponse?.trimStart().startsWith('{')) {
      const data = objectData(this.rawResponse);
      throw providerError(data) || apiError('API 未返回 SSE 流式响应');
    }
    if (this.error) throw this.error;
    if (!this.ended && !this.stopped) throw apiError('API 流式响应中断，译文未完成');
    const text = translationText(this.rawText);
    if (!text) throw apiError('API 未返回译文');
    return text;
  }

  getProviderError(): ServiceError | undefined {
    if (!this.rawResponse?.trimStart().startsWith('{')) return;
    try { return providerError(objectData(this.rawResponse)); } catch { return; }
  }
}
