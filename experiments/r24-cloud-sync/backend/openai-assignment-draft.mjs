const endpoint = 'https://api.openai.com/v1/responses';
const maxPromptBytes = 128 * 1024;
const maxResponseBytes = 256 * 1024;

const format = {
  type: 'json_schema',
  name: 'assignment_draft',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['question', 'answer', 'keyPoints'],
          properties: {
            question: {type: 'string'},
            answer: {type: 'string'},
            keyPoints: {type: 'array', items: {type: 'string'}},
          },
        },
      },
    },
  },
};

async function completedDraftText(response) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxResponseBytes) throw new Error('Response too large');
    chunks.push(chunk);
  }
  const result = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  if (result.status !== 'completed' || result.error || !Array.isArray(result.output)) {
    throw new Error('Response incomplete');
  }
  const messages = result.output.filter(item => item.type !== 'reasoning');
  const [message] = messages;
  if (messages.length !== 1 || message.type !== 'message' || message.role !== 'assistant' ||
      message.status !== 'completed' || !Array.isArray(message.content) ||
      !message.content.every(part => part.type === 'output_text' && typeof part.text === 'string')) {
    throw new Error('Unexpected model output');
  }
  const text = message.content.map(part => part.text).join('');
  if (!text.trim()) throw new Error('Empty draft');
  return text;
}

// Server-side only. The host authorizes the operator and reserves quota before calling generate.
export function createOpenAIDraftGenerator({apiKey, model, maxOutputTokens = 4096, fetchImpl = fetch}) {
  if (typeof apiKey !== 'string' || !apiKey.length || /\s/.test(apiKey) ||
      typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,150}$/.test(model) ||
      !Number.isInteger(maxOutputTokens) || maxOutputTokens < 16 || maxOutputTokens > 4096) {
    throw new Error('Invalid OpenAI draft configuration');
  }
  return async function generate(prompt) {
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt, 'utf8') > maxPromptBytes) {
      throw new Error('Invalid assignment draft prompt');
    }
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
        redirect: 'error',
        signal: AbortSignal.timeout(24_000),
        body: JSON.stringify({model, input: prompt, text: {format}, max_output_tokens: maxOutputTokens, store: false}),
      });
    } catch {
      throw new Error('OpenAI draft request failed');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`OpenAI draft request failed (HTTP ${response.status})`), {status: response.status});
    }
    try {
      return await completedDraftText(response);
    } catch {
      throw new Error('OpenAI draft response was incomplete or invalid');
    }
  };
}
