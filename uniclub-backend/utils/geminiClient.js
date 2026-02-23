let cachedModel = null;

async function getGeminiModel() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in the environment');
  }

  if (cachedModel) return cachedModel;

  const { GoogleGenAI } = await import('@google/genai');
  const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  cachedModel = client;
  return cachedModel;
}

async function generateText(prompt, options = {}) {
  const client = await getGeminiModel();

  const generationConfig = {};
  if (typeof options.maxTokens === 'number') {
    generationConfig.maxOutputTokens = options.maxTokens;
  }
  if (typeof options.temperature === 'number') {
    generationConfig.temperature = options.temperature;
  }

  const result = await client.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: generationConfig,
  });

  // Flatten text parts from first candidate
  const candidate = result.candidates && result.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  if (!parts) return '';
  return parts.map(p => p.text || '').join('');
}

module.exports = {
  generateText,
};

