# 자캐커플한테 테이프 한 개 — 배포 안내

## 0. 필요한 것

- Node.js 18 이상
- GitHub 계정
- Netlify 계정
- Anthropic API 키 (console.anthropic.com)

---

## 1. 내 컴퓨터에서 먼저 확인

```bash
npm install
npm run dev
```

`http://localhost:5173` 이 열립니다.

이때 **굽기는 실패합니다.** 정상입니다. API 키가 없어서 프록시 함수가 응답을 못 하기 때문입니다.
화면·업로드·음반 뷰·PNG 저장은 이 단계에서 모두 확인할 수 있습니다.

굽기까지 로컬에서 확인하려면:

```bash
npm install -g netlify-cli
netlify login
netlify link          # 아직 사이트가 없으면 3번 먼저 진행
netlify env:set ANTHROPIC_API_KEY sk-ant-...
netlify dev           # 함수까지 같이 띄움
```

---

## 2. GitHub에 올리기

```bash
git init
git add .
git commit -m "first"
git branch -M main
git remote add origin https://github.com/<계정>/<저장소>.git
git push -u origin main
```

`.gitignore` 에 `.env` 와 `node_modules` 가 들어 있습니다.
**API 키는 절대 코드나 저장소에 넣지 마세요.**

---

## 3. Netlify에 연결

1. Netlify → **Add new site** → **Import an existing project** → GitHub 저장소 선택
2. 빌드 설정은 `netlify.toml` 에 이미 들어 있어 그대로 두면 됩니다
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
3. **Deploy site**

---

## 4. API 키 등록 (가장 중요)

Netlify → **Site configuration** → **Environment variables** → **Add a variable**

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` |

저장한 뒤 **Deploys → Trigger deploy → Clear cache and deploy site** 로 한 번 다시 배포해야
함수가 새 환경변수를 읽습니다.

---

## 5. 예산 상한 걸기 (반드시)

console.anthropic.com → **Limits** → 월 예산 상한 설정.

코드 쪽 방어가 뚫려도 여기서 막힙니다. 이 단계를 건너뛰지 마세요.

현재 걸려 있는 코드 쪽 방어 (`netlify/functions/mixtape.mjs`):

- IP당 시간당 8회
- 전체 시간당 400회
- 클라이언트가 보낸 `model` / `max_tokens` 무시하고 서버 값 강제
- 이미지 2장 초과·용량 초과 차단

트래픽이 예상보다 크게 몰리면 `GLOBAL_PER_HOUR` 숫자를 낮추세요.

---

## 6. 배포 후 확인할 것

- [ ] 그림 2장 업로드 → 카세트 셸 색이 자캐 색으로 바뀌는가
- [ ] 굽기 성공 (실패하면 Netlify → Functions → `mixtape` 로그 확인)
- [ ] 재생 버튼 → 실제로 30초 미리듣기 소리가 나는가
      (아티팩트 미리보기에서는 막혀 있었지만 배포본에서는 나와야 정상.
       `MUTE` 로 뜨는 곡은 애플에 프리뷰가 없는 곡입니다)
- [ ] 음반 뷰 → 재킷 클릭 시 뒷면 트랙리스트
- [ ] PNG 저장 2종 (카드 / 음반)
- [ ] 휴대폰에서 열어보기

---

## 7. 배포 전 지울 것

`src/PairMixtape.jsx` 하단의 미리보기 폭 전환 버튼:

- JSX: `{/* 미리보기 폭 전환 ... */}` 로 시작하는 `<div className="dev-tg">` 블록
- CSS: `.dev-tg` 로 시작하는 규칙들

없어도 동작에는 지장 없지만, 사용자에게 보일 필요는 없는 개발용 도구입니다.

---

## 파일 구조

```
index.html                     페이지 껍데기, OG 태그
vite.config.js                 빌드 설정
netlify.toml                   Netlify 빌드·함수·리다이렉트 설정
src/main.jsx                   React 진입점
src/PairMixtape.jsx            앱 본체 (텍스처·카세트 사진 인라인 포함)
netlify/functions/mixtape.mjs  API 프록시 — 키는 여기서만 쓰임
```

## 비용 참고

1회 굽기당 입력 약 2,200토큰 / 출력 약 600토큰.
Sonnet 5 기준 회당 약 15원, 2026년 9월 정가 전환 후 약 22원입니다.
