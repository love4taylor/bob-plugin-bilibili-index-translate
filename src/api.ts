import type { HttpResponse, ServiceError } from '@bob-translate/types';
import { buildPrompt } from './prompt';

export const API_URL = 'https://index-translate.bilibili.com/v1/chat/completions';
export const MODEL = 'Index-Translate-35B-A3B';
export const TIMEOUT = 120000;
export const HEADERS = {
  'Content-Type': 'application/json',
};

export function parseMaxTokens(value?: string): number | undefined {
  const input = (value || '').trim();
  if (!input || input === 'default') return undefined;
  // Accept previously saved positive integers from the text-field versions too.
  const number = Number(input);
  if (!/^[1-9]\d*$/.test(input) || !Number.isSafeInteger(number)) {
    throw { type: 'param', message: '最大输出 token 必须为正整数' };
  }
  return number;
}

export function buildBody(text: string, source: string, target: string, stream: boolean, maxTokens?: number, glossary?: string) {
  return {
    model: MODEL,
    messages: [{ role: 'user', content: buildPrompt(text, source, target, glossary) }],
    temperature: 0.0,
    ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
    stream,
    chat_template_kwargs: { enable_thinking: false },
  };
}

export function apiError(message: string): ServiceError {
  return { type: 'api', message, troubleshootingLink: 'https://index-translate.bilibili.com' };
}

export function asError(error: unknown, type: ServiceError['type'] = 'api'): ServiceError {
  if (error && typeof error === 'object' && 'type' in error && 'message' in error) {
    return error as ServiceError;
  }
  const message = error && typeof error === 'object' && 'message' in error
    ? String(error.message) : String(error || '请求失败');
  return { type, message, troubleshootingLink: 'https://index-translate.bilibili.com' };
}

export function objectData(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw apiError('API 响应不是有效 JSON'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw apiError('API 响应格式无效');
  }
  return value as Record<string, unknown>;
}

export function providerError(data: Record<string, unknown>): ServiceError | undefined {
  if (!data.error) return;
  const error = data.error;
  return apiError(typeof error === 'string' ? error :
    error && typeof error === 'object' && 'message' in error ? String(error.message) : 'API 返回错误');
}

export function checkResponse(response: HttpResponse<unknown>): void {
  if (response.error) throw asError(response.error, 'network');
  const status = response.response?.statusCode;
  if (!status || status < 200 || status >= 300) {
    let error: ServiceError | undefined;
    try { error = providerError(objectData(response.data)); } catch { /* HTTP status is the fallback. */ }
    throw error || apiError(status === 429 ? '免费 API 请求过于频繁，请稍后重试（HTTP 429）' : `API 请求失败（HTTP ${status || '未知'}）`);
  }
}

export function checkFinish(reason: unknown, maxTokens?: number): void {
  if (reason === 'length') {
    const limit = maxTokens === undefined ? '服务端输出上限' : `${maxTokens} token 输出上限`;
    throw apiError(`译文达到${maxTokens === undefined ? '' : ' '}${limit}，请调整最大输出 token 数或分段翻译`);
  }
  if (reason === 'content_filter') throw apiError('API 内容过滤，未完成翻译');
  if (reason && reason !== 'stop') throw apiError(`API 未正常完成翻译：${String(reason)}`);
}

// Never display a partial thought block, even if its opening tag spans SSE chunks.
export function translationText(raw: string): string {
  const text = raw.trim();
  if (text.startsWith('<think>')) {
    const end = text.indexOf('</think>', 7);
    return end >= 0 ? text.slice(end + 8).trim() : '';
  }
  if (text && '<think>'.startsWith(text)) return '';
  return text;
}

export function parseResponse(response: HttpResponse<unknown>, maxTokens?: number): string {
  checkResponse(response);
  const data = objectData(response.data);
  const error = providerError(data);
  if (error) throw error;
  const choices = data.choices;
  if (!Array.isArray(choices) || !choices.length) throw apiError('API 未返回译文');
  const choice = objectData(choices[0]);
  checkFinish(choice.finish_reason, maxTokens);
  const message = objectData(choice.message);
  const text = typeof message.content === 'string' ? translationText(message.content) : '';
  if (!text) throw apiError('API 未返回译文');
  return text;
}
