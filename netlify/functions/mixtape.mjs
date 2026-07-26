// netlify/functions/mixtape.mjs
//
// 프론트엔드는 이 함수로만 요청을 보냅니다.
// API 키는 서버 환경변수에만 존재하고 브라우저로 절대 내려가지 않습니다.
//
// 프론트엔드가 보내는 형식 (공급자 중립):
//   { images: [{ mime, data }], prompt: "..." }
// 이 함수가 돌려주는 형식:
//   { text: "모델이 생성한 JSON 문자열" }
//
// 배포 전 준비
//   1) Netlify → Site configuration → Environment variables
//      GEMINI_API_KEY = ...
//   2) Deploys → Trigger deploy → Clear cache and deploy site

const MODEL = "gemini-3.6-flash"; // 더 저렴하게: "gemini-3.5-flash-lite"
const MAX_TOKENS = 4096; // thinking 토큰까지 포함되므로 넉넉히 잡습니다
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const WINDOW_MS = 60 * 60 * 1000;
const PER_IP_PER_HOUR = 8;
const GLOBAL_PER_HOUR = 400;

const hits = new Map();
let globalHits = [];

function tooMany(ip) {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < WINDOW_MS);
  if (globalHits.length >= GLOBAL_PER_HOUR) return "global";
  const mine = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (mine.length >= PER_IP_PER_HOUR) return "ip";
  mine.push(now);
  hits.set(ip, mine);
  globalHits.push(now);
  if (hits.size > 5000) hits.clear();
  return null;
}

const OK_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY 환경변수가 없습니다.");
    return Response.json({ error: "서버 설정이 아직 준비되지 않았어요." }, { status: 500 });
  }

  const ip =
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";

  const limited = tooMany(ip);
  if (limited) {
    return Response.json(
      {
        error:
          limited === "ip"
            ? "잠시 뒤에 다시 시도해 주세요. (시간당 8개까지 만들 수 있어요)"
            : "지금 이용자가 많아요. 잠시 뒤에 다시 시도해 주세요.",
      },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const images = Array.isArray(body?.images) ? body.images : [];

  if (!prompt || prompt.length > 8000) {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!images.length || images.length > 2) {
    return Response.json({ error: "이미지는 1~2장까지 가능합니다." }, { status: 400 });
  }
  for (const im of images) {
    if (!OK_MIME.includes(im?.mime) || typeof im?.data !== "string") {
      return Response.json({ error: "지원하지 않는 이미지 형식입니다." }, { status: 400 });
    }
  }
  const bytes = images.reduce((n, im) => n + im.data.length * 0.75, 0);
  if (bytes > 9.5 * 1024 * 1024) {
    return Response.json({ error: "이미지 용량이 너무 큽니다." }, { status: 413 });
  }

  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              ...images.map((im) => ({ inlineData: { mimeType: im.mime, data: im.data } })),
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: MAX_TOKENS,
        },
        safetySettings: [
          "HARM_CATEGORY_HARASSMENT",
          "HARM_CATEGORY_HATE_SPEECH",
          "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          "HARM_CATEGORY_DANGEROUS_CONTENT",
        ].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" })),
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      console.error("gemini error", r.status, JSON.stringify(data).slice(0, 600));
      if (r.status === 429) {
        return Response.json(
          { error: "지금 요청이 몰려 있어요. 30초 뒤에 다시 시도해 주세요." },
          { status: 429 }
        );
      }
      return Response.json(
        { error: "지금은 테이프를 구울 수 없어요. 잠시 뒤에 다시 시도해 주세요." },
        { status: 502 }
      );
    }

    const cand = data?.candidates?.[0];
    if (data?.promptFeedback?.blockReason || cand?.finishReason === "SAFETY") {
      return Response.json(
        { error: "이 그림으로는 만들 수 없었어요. 다른 그림으로 시도해 주세요." },
        { status: 422 }
      );
    }

    const text = (cand?.content?.parts || [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("");

    if (!text) {
      console.error("empty candidate", JSON.stringify(data).slice(0, 600));
      return Response.json({ error: "응답이 비어 있었어요. 다시 시도해 주세요." }, { status: 502 });
    }

    return Response.json({ text }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "네트워크 오류가 발생했어요." }, { status: 502 });
  }
};
