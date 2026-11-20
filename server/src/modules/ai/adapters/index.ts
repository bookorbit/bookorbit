import type { AiApiType } from '@bookorbit/types';

import type { AiAdapter } from './ai-adapter.interface';
import { AnthropicMessagesAdapter } from './anthropic-messages.adapter';
import { OpenAiChatAdapter } from './openai-chat.adapter';
import { OpenAiResponsesAdapter } from './openai-responses.adapter';

/** One adapter per API type. A fourth type is one more file and one more line here. */
export const AI_ADAPTERS: Record<AiApiType, AiAdapter> = {
  'openai-chat': new OpenAiChatAdapter(),
  'anthropic-messages': new AnthropicMessagesAdapter(),
  'openai-responses': new OpenAiResponsesAdapter(),
};
