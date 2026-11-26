const fetch = global.fetch;

async function createScript({ topic, ageRange, duration, style, language }) {
  const prompt = `Crie um roteiro infantil original e adequado para crianças. Tema: ${topic}. Faixa etária: ${ageRange}. Duração aproximada: ${duration} minutos. Estilo: ${style}. Idioma: ${language}.
Retorne SOMENTE JSON válido com: title, synopsis, moral, scenes (array de objetos com scene, seconds, narration, visual_prompt, camera, sound). Evite sustos intensos, violência, publicidade disfarçada, desafios perigosos e personagens protegidos por direitos autorais.`;
  if (process.env.OPENAI_API_KEY) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini", temperature: 0.8, messages: [{ role: "system", content: "Você é roteirista de conteúdo infantil seguro, criativo e original. Responda em JSON válido." }, { role: "user", content: prompt }], response_format: { type: "json_object" } })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Falha na API OpenAI");
    return JSON.parse(data.choices[0].message.content);
  }
  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt + "\nResponda apenas JSON válido." }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.8 } }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Falha na API Gemini");
    return JSON.parse(data.candidates[0].content.parts.map(p => p.text || "").join(""));
  }
  throw new Error("Configure OPENAI_API_KEY ou GEMINI_API_KEY para gerar roteiros.");
}

async function startMiniMaxVideo({ prompt, imageUrl, duration = 6, aspectRatio = "16:9" }) {
  if (!process.env.MINIMAX_API_KEY) throw new Error("Configure MINIMAX_API_KEY para gerar vídeos.");
  const base = (process.env.MINIMAX_API_BASE || "https://api.minimax.io").replace(/\/$/, "");
  const body = {
    model: process.env.MINIMAX_VIDEO_MODEL || "MiniMax-Hailuo-2.3",
    prompt: `${prompt}${aspectRatio === "9:16" ? " Composição vertical em formato retrato 9:16." : " Composição horizontal em formato paisagem 16:9."}`, duration: Number(duration) === 10 ? 10 : 6,
    resolution: "768P", prompt_optimizer: true,
    ...(imageUrl ? { first_frame_image: imageUrl } : {})
  };
  const headers = { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`, "Content-Type": "application/json" };
  const r = await fetch(`${base}/v1/video_generation`, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok || data.base_resp?.status_code !== 0) throw new Error(data.base_resp?.status_msg || data.message || "Falha ao iniciar vídeo MiniMax");
  return data.task_id;
}

async function pollMiniMaxVideo(taskId) {
  const base = (process.env.MINIMAX_API_BASE || "https://api.minimax.io").replace(/\/$/, "");
  const r = await fetch(`${base}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` }
  });
  const data = await r.json();
  if (!r.ok || data.base_resp?.status_code !== 0) throw new Error(data.base_resp?.status_msg || "Falha ao consultar vídeo");
  const status = String(data.status || "").toLowerCase();
  if (["success", "succeeded", "completed"].includes(status)) {
    const fileId = data.file_id;
    if (!fileId) return { status: "completed", resultUrl: data.video_url || null };
    const fr = await fetch(`${base}/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`, { headers: { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}` } });
    const fd = await fr.json();
    if (!fr.ok) throw new Error(fd.base_resp?.status_msg || "Não foi possível recuperar o arquivo");
    return { status: "completed", resultUrl: fd.file?.download_url || fd.download_url || null };
  }
  if (["failed", "error"].includes(status)) return { status: "failed", error: data.error || data.base_resp?.status_msg || "Geração de vídeo falhou" };
  return { status: "processing" };
}

module.exports = { createScript, startMiniMaxVideo, pollMiniMaxVideo };
