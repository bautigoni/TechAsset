import { config } from '../config.js';

export async function callOpenAiResponses({ input, instructions, tools, toolChoice = 'auto', maxOutputTokens }) {
  if (!config.openaiApiKey) throw new Error('OpenAI no está configurado.');
  const body = { model: config.openaiModel || 'gpt-4.1-mini', input };
  if (instructions) body.instructions = instructions;
  if (Array.isArray(tools) && tools.length) { body.tools = tools; body.tool_choice = toolChoice; }
  if (maxOutputTokens) body.max_output_tokens = maxOutputTokens;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

export function responseOutputText(data) {
  if (data?.output_text) return String(data.output_text).trim();
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (item?.type !== 'message') continue;
    for (const chunk of Array.isArray(item.content) ? item.content : []) if (typeof chunk?.text === 'string' && chunk.text.trim()) return chunk.text.trim();
  }
  return '';
}
