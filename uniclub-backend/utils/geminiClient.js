let cachedClient = null;

const MODEL = 'gemini-2.5-flash-lite';

async function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in the environment');
  }
  if (cachedClient) return cachedClient;
  const { GoogleGenAI } = await import('@google/genai');
  cachedClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return cachedClient;
}

async function generateText(prompt, options = {}) {
  const client = await getClient();

  const generationConfig = {};
  if (typeof options.maxTokens === 'number') {
    generationConfig.maxOutputTokens = options.maxTokens;
  }
  if (typeof options.temperature === 'number') {
    generationConfig.temperature = options.temperature;
  }

  const result = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: Object.keys(generationConfig).length ? generationConfig : undefined,
  });

  const candidate = result.candidates && result.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  if (!parts || parts.length === 0) return '';

  // Skip internal thought parts (thinking models), keep only visible output
  return parts
    .filter(p => !p.thought)
    .map(p => p.text || '')
    .join('');
}

module.exports = { generateText };
