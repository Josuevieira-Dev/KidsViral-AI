const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

async function createScript({ concept, audience = '3-8 anos', style = 'Animação 3D colorida', provider = 'auto' }) {
  const prompt = `Crie um roteiro ORIGINAL para um vídeo infantil seguro e adequado à faixa ${audience}.
Tema: ${concept}
Estilo visual: ${style}
Responda somente JSON válido com as chaves: title, synopsis, moral, scenes.
scenes deve ser uma lista de 4 a 8 objetos com: number, narration, visual_prompt, duration_seconds.
Use linguagem simples, positiva, sem violência, medo intenso, publicidade ou personagens protegidos por direitos autorais.`;

  if ((provider === 'openai' || provider === 'auto') && process.env.OPENAI_API_KEY) {
    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini',
        messages: [{ role: 'system', content: 'Você é roteirista de conteúdo infantil original, seguro e educativo. Retorne apenas JSON válido.' }, { role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.8
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Falha na OpenAI');
    return { provider: 'openai', script: JSON.parse(data.choices[0].message.content) };
  }

  if ((provider === 'gemini' || provider === 'auto') && process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt + '\\nRetorne exclusivamente JSON, sem bloco markdown.' }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.8 }
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Falha no Gemini');
    const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
    if (!raw) throw new Error('O Gemini não retornou um roteiro.');
    return { provider: 'gemini', script: JSON.parse(raw) };
  }

  throw new Error('Configure OPENAI_API_KEY ou GEMINI_API_KEY para criar roteiros.');
}

async function startMiniMaxVideo({ prompt, duration = 6, imageUrl }) {
  if (!process.env.MINIMAX_API_KEY) throw new Error('Configure MINIMAX_API_KEY para gerar vídeos.');
  const base = (process.env.MINIMAX_API_BASE || 'https://api.minimax.io').replace(/\/$/, '');
  const body = {
    model: process.env.MINIMAX_VIDEO_MODEL || 'MiniMax-Hailuo-2.3',
    prompt,
    duration: Number(duration) === 10 ? 10 : 6,
    resolution: '768P',
    prompt_optimizer: true
  };
  if (imageUrl) body.first_frame_image = imageUrl;
  const response = await fetch(`${base}/v1/video_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.base_resp?.status_code) {
    throw new Error(data.base_resp?.status_msg || data.message || 'Falha ao solicitar vídeo na MiniMax');
  }
  const taskId = data.task_id || data.id;
  if (!taskId) throw new Error('A MiniMax não retornou o identificador da tarefa.');
  return { taskId, provider: 'minimax' };
}

async function getMiniMaxVideo(taskId) {
  const base = (process.env.MINIMAX_API_BASE || 'https://api.minimax.io').replace(/\/$/, '');
  const response = await fetch(`${base}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.base_resp?.status_msg || data.message || 'Falha ao consultar vídeo');
  const status = String(data.status || data.task_status || 'processing').toLowerCase();
  let resultUrl = data.file_url || data.video_url || data.download_url || null;
  if (!resultUrl && data.file_id && ['success', 'succeed', 'completed'].includes(status)) {
    const fileResponse = await fetch(`${base}/v1/files/retrieve?file_id=${encodeURIComponent(data.file_id)}`, {
      headers: { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` }
    });
    const fileData = await fileResponse.json();
    resultUrl = fileData.file?.download_url || fileData.download_url || null;
  }
  return { status, resultUrl, raw: data };
}

module.exports = { createScript, startMiniMaxVideo, getMiniMaxVideo };
