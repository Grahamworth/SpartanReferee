'use strict';
/* The Assistant's models on Azure AI Foundry (21 November 2026): the resource spartanreferee-ai in rg-spartanreferee-uksouth, with
   two deployments: "luna" (OpenAI's gpt-6-luna, Global Standard, pay as you go) answers, and "embed" (text-embedding-3-small) turns
   text into vectors for finding the passages a question needs. Settings: ASSISTANT_ENDPOINT, ASSISTANT_KEY (a secret),
   ASSISTANT_MODEL, ASSISTANT_EMBED. Plain fetch to the OpenAI v1 API Azure serves, so the API needs no extra package. */

// Azure's list prices in pounds per million tokens (prices.azure.com, UK South, 21 November 2026). gpt-6-luna is priced by how long
// the prompt is: "short context" up to its threshold, "long context" beyond it; the Assistant's prompts stay short.
const PRICES = {
  'gpt-6-luna': { input: 0.0752, cached: 0.0075, output: 0.3759 },
  'text-embedding-3-small': { input: 0.0151 },
};

function createAi({ endpoint, key, model = 'luna', embedModel = 'embed', doFetch = fetch }) {
  if (!endpoint || !key) return null;
  const base = `${String(endpoint).replace(/\/+$/, '')}/openai/v1`;
  async function post(path, body, timeoutMs = 60000) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await doFetch(`${base}/${path}`, { method: 'POST', headers: { 'api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || `The model answered ${r.status}`), { status: r.status, code: j.error && j.error.code });
      return j;
    } finally { clearTimeout(t); }
  }
  return {
    model,
    /** texts -> { vectors: Float32Array[], tokens } (up to 2048 texts a call) */
    async embed(texts) {
      const out = [], all = [].concat(texts);
      let tokens = 0;
      for (let i = 0; i < all.length; i += 256) {
        const j = await post('embeddings', { model: embedModel, input: all.slice(i, i + 256) });
        for (const d of j.data.sort((a, b) => a.index - b.index)) out.push(Float32Array.from(d.embedding));
        tokens += (j.usage && j.usage.prompt_tokens) || 0;
      }
      return { vectors: out, tokens };
    },
    /** one turn of the Responses API (Luna reasons and calls tools only there): nothing is stored at Azure (store: false), so the
     *  reasoning comes back encrypted, to be passed back with the tool results */
    respond(body) { return post('responses', { model, store: false, include: ['reasoning.encrypted_content'], ...body }, 90000); },
  };
}

/** what a reply's usage cost, in pounds */
function costOf(usage = {}, kind = 'gpt-6-luna') {
  const p = PRICES[kind] || PRICES['gpt-6-luna'];
  const t = tokensOf(usage), input = Math.max(0, t.input - t.cached);
  return (input * p.input + t.cached * (p.cached || p.input) + t.output * (p.output || 0)) / 1e6;
}
/** { input, cached, output } from either API's usage (chat completions or responses) */
function tokensOf(u = {}) {
  return { input: u.input_tokens ?? u.prompt_tokens ?? 0, cached: (u.input_tokens_details || u.prompt_tokens_details || {}).cached_tokens || 0, output: u.output_tokens ?? u.completion_tokens ?? 0 };
}

module.exports = { createAi, costOf, tokensOf, PRICES };
