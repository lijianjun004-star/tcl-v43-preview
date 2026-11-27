// Older OpenAI draft responses identified their source but omitted the model name.
export function aiModelLabel(result) {
  if (result?.degraded !== false) return '';
  if (result.source === 'openai_gateway') {
    if (result.model == null) return 'OpenAI 网关';
    if (['gpt-4o-mini', 'gpt-4o'].includes(result.model)) return 'OpenAI · ' + result.model;
  }
  if (result.source === 'cloudbase_hunyuan' && ['hy3', 'hy3-preview'].includes(result.model)) {
    return '腾讯混元 · ' + result.model;
  }
  return '';
}
