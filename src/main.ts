import type { TextTranslateQuery, PluginValidate, HttpResponse } from '@bob-translate/types';
import { API_URL, HEADERS, TIMEOUT, asError, buildBody, checkResponse, parseResponse, parseMaxTokens } from './api';
import { languageNames } from './languages';
import { TranslationStream } from './stream';

export const pluginTimeoutInterval = () => TIMEOUT / 1000;
export const supportLanguages = () => ['auto', ...Object.keys(languageNames)];

export function translate(query: TextTranslateQuery): void {
  let completed = false;
  const complete = (text?: string, error?: unknown) => {
    if (completed) return;
    completed = true;
    if (error) query.onCompletion({ error: asError(error) });
    else query.onCompletion({ result: { from: query.detectFrom, to: query.detectTo, toParagraphs: [text || ''] } });
  };
  try {
    if (!query.text.trim()) throw { type: 'param', message: '请输入需要翻译的文本' };
    const stream = $option.stream !== 'false';
    const maxTokens = parseMaxTokens($option.maxTokens);
    const config = {
      method: 'POST' as const,
      url: API_URL,
      header: HEADERS,
      body: buildBody(query.text, query.detectFrom, query.detectTo, stream, maxTokens, $option.glossary),
      timeout: TIMEOUT,
      cancelSignal: query.cancelSignal,
    };
    if (stream) {
      const reader = new TranslationStream((text) => {
        if (!completed) query.onStream({ result: { from: query.detectFrom, to: query.detectTo, toParagraphs: [text] } });
      }, maxTokens);
      $http.streamRequest({
        ...config,
        streamHandler: (chunk) => { if (!completed && chunk.text) reader.feed(chunk.text); },
        handler: (response) => {
          if (completed) return;
          try {
            if (response.error) throw asError(response.error, 'network');
            // Bob sometimes delivers HTTP error JSON only via streamHandler.
            if (response.response?.statusCode >= 400) {
              const error = reader.getProviderError();
              if (error) throw error;
            }
            checkResponse(response);
            complete(reader.finish());
          } catch (error) { complete(undefined, error); }
        },
      });
    } else {
      void $http.request<unknown, HttpResponse<unknown>>(config).then((response) => {
        if (!completed) complete(parseResponse(response, maxTokens));
      }).catch((error: unknown) => complete(undefined, asError(error, 'network')));
    }
  } catch (error) { complete(undefined, error); }
}

// Bob's optional service validation checks connectivity, without any credential setting.
export const pluginValidate: PluginValidate = (completion) => {
  try {
    const maxTokens = parseMaxTokens($option.maxTokens);
    void $http.request<unknown, HttpResponse<unknown>>({ method: 'POST', url: API_URL, header: HEADERS,
      body: buildBody('Hello.', 'en', 'zh-Hans', false, maxTokens, $option.glossary), timeout: TIMEOUT,
    }).then((response) => { parseResponse(response, maxTokens); completion({ result: true }); })
      .catch((error: unknown) => completion({ result: false, error: asError(error, 'network') }));
  } catch (error) { completion({ result: false, error: asError(error, 'network') }); }
};
