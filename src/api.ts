const API_BASE = 'https://grsai.dakka.com.cn';

export interface GenerateParams {
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio: string;
  imageSize: string;
  urls: string[];
}

export async function submitGeneration(params: GenerateParams) {
  const res = await fetch(`${API_BASE}/v1/draw/nano-banana`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
      imageSize: params.imageSize,
      urls: params.urls,
      webHook: "-1",
      shutProgress: false
    })
  });
  return res.json();
}

export async function pollResult(apiKey: string, id: string) {
  const res = await fetch(`${API_BASE}/v1/draw/result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ id })
  });
  return res.json();
}