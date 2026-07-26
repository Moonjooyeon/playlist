// netlify/functions/mixtape.js
//
// 프론트엔드는 이 함수로만 요청을 보냅니다. API 키는 서버 환경변수에만 존재하고
// 브라우저로 절대 내려가지 않습니다.
//
// 배포 전 준비
//   1) Netlify 대시보드 → Site settings → Environment variables
//      ANTHROPIC_API_KEY = sk-ant-...
//   2) 프론트엔드의 API_ENDPOINT 를 "/.netlify/functions/mixtape" 으로 변경
//   3) console.anthropic.com → Limits 에서 월 예산 상한(Spend limit)을 반드시 설정

const MODEL = "claude-sonnet-5"; // 비용을 더 낮추려면 "claude-haiku-4-5-20251001"
const MAX_TOKENS = 1000;

// IP당 제한 (함수 인스턴스 메모리 기준 — 완벽하진 않지만 1차 방어로 충분)
const WINDOW_MS = 60 * 60 * 1000; // 1시간
const PER_IP_PER_HOUR = 8;
const GLOBAL_PER_HOUR = 400; // 전체 상한: 시간당 400회 ≈ 하루 최대 약 9,600회

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
  if (hits.size > 5000) hits.clear(); // 메모리 방어
  return null;
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
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

  // 클라이언트가 보낸 model/max_tokens 는 신뢰하지 않고 서버 값으로 고정합니다.
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages) {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  // 이미지 개수·용량 상한 (비용 폭주 방지)
  const imgs = messages
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((c) => c.type === "image");
  if (imgs.length > 2) {
    return Response.json({ error: "이미지는 최대 2장까지 가능합니다." }, { status: 400 });
  }
  const bytes = imgs.reduce((n, c) => n + (c.source?.data?.length || 0) * 0.75, 0);
  if (bytes > 9.5 * 1024 * 1024) {
    return Response.json({ error: "이미지 용량이 너무 큽니다." }, { status: 413 });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("anthropic error", r.status, detail.slice(0, 500));
      return Response.json(
        { error: "지금은 테이프를 구울 수 없어요. 잠시 뒤에 다시 시도해 주세요." },
        { status: 502 }
      );
    }

    return Response.json(await r.json(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "네트워크 오류가 발생했어요." }, { status: 502 });
  }
};
