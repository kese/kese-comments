# kese-comments

[sof.kr](https://sof.kr) (kese 개인 블로그)의 댓글 저장소 + 알림/모더레이션 자동화입니다.
[oy-techblog/tech-blog-comment](https://github.com/oy-techblog/tech-blog-comment) (MIT)를 개인 블로그 구조에 맞게 각색했습니다.

## 동작 방식

1. 방문자가 sof.kr 포스트 하단의 [utterances](https://utteranc.es) 위젯으로 댓글 작성 (GitHub 로그인 필요)
2. utterances가 이 저장소(`kese/kese-comments`, 공개)에 포스트별 Issue를 만들고 댓글을 Issue 댓글로 저장
3. `issue_comment.created` 이벤트로 GitHub Actions 워크플로우 실행
   - Issue 제목(`/blog/<slug>/`)에서 포스트 slug 추출
   - `kese/kese-blog`의 `content/posts/<slug>/index.md`에서 포스트와 `author` 필드 확인
   - `content/authors.yaml`에서 작성자 GitHub 계정 조회
4. AI 댓글 분석 및 모더레이션 (`GEMINI_API_KEY` 설정 시)
   - Gemini로 댓글 분류·감정·Toxicity Level(0-5) 분석, 추천 답변 2-3개 생성
   - Level 4+ 악성 댓글 즉시 삭제 (증거는 알림에 보존)
5. `kese/kese-blog`에 알림 Issue 생성 (같은 포스트 Issue가 열려 있으면 댓글로 추가 — 중복 방지)
   - Level 3+ 는 `moderation` 라벨 + 관리자 멘션
6. 월별 `[Metrics] YYYY-MM 댓글 알림 통계` Issue에 이벤트 기록

## 왜 공개 저장소인가

utterances는 로그인하지 않은 방문자도 댓글을 **읽을 수 있어야** 하므로 저장소가 반드시 공개여야 한다.
댓글 원문은 어차피 블로그에 공개 표시되는 내용이고, 알림·AI 분석 결과·메트릭은 비공개 `kese-blog` 저장소에 기록된다.

## 필요한 설정

### 1. utterances 앱 설치 (필수, 수동)

이 저장소에 utterances GitHub App이 설치되어 있어야 위젯이 Issue를 만들 수 있다:

1. <https://github.com/apps/utterances> 접속
2. **Install** → `kese` 계정 → `kese-comments` 저장소만 선택
3. 설치 후 블로그 포스트 하단에서 댓글 작성 가능

### 2. GitHub Secrets

이 저장소의 Settings → Secrets and variables → Actions:

| Secret | 필수 | 용도 |
|---|---|---|
| `BLOG_ACCESS_TOKEN` | ✅ | 비공개 `kese-blog` 체크아웃 + 알림 Issue 생성용 fine-grained PAT. 권한: `kese-blog`의 **Contents: Read**, **Issues: Read & write** |
| `GEMINI_API_KEY` | 선택 | Gemini AI 댓글 분석·모더레이션·추천 답변. 없으면 알림만 동작 |

`BLOG_ACCESS_TOKEN` 생성: GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Repository access에서 `kese-blog`만 선택 → Repository permissions: Contents=Read, Issues=Read and write.

### 3. 환경 변수 (선택, 기본값 있음)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `BLOG_OWNER` / `BLOG_REPO` | `kese` / `kese-blog` | 알림 Issue 대상 저장소 |
| `MODERATORS` | `kese` | 모더레이션 알림 멘션 대상 (쉼표 구분) |
| `GEMINI_MODEL` | `gemini-3-flash-preview` | 분석 모델 |
| `BLOG_PATH` | Actions: `blog`, 로컬: `../kesekr` | 블로그 체크아웃 경로 |
| `COMMENTS_OWNER` / `COMMENTS_REPO` | `kese` / `kese-comments` | 로컬 테스트 시 읽을 댓글 저장소 |

## 모더레이션 레벨

| Level | 설명 | 조치 |
|---|---|---|
| 0-2 | 건전 ~ 부정적이지만 예의 있음 | 일반 알림 |
| 3 | 무례·비꼼 | 모더레이션 알림 + 관리자 멘션 |
| 4-5 | 욕설·인신공격·혐오·심각한 위협 | 댓글 즉시 삭제 + 증거 보존 알림 |

감지 항목: profanity, personal_attack, trolling, disrespectful, hate_speech, spam, off_topic.

## 로컬 테스트

```powershell
npm install

# dry-run (읽기 전용, 토큰 불필요) — Issue 1번을 읽고 알림 내용만 출력
$env:ISSUE_NUMBER='1'; node scripts/notify-comment.js

# 실제 알림 생성
$env:BLOG_ACCESS_TOKEN='...'; $env:ENABLE_NOTIFICATION='true'; $env:ISSUE_NUMBER='1'; node scripts/notify-comment.js
```

로컬에서는 블로그 저장소를 `../kesekr`에서 자동으로 찾거나 `BLOG_PATH`로 지정한다.

## 구조

- `scripts/notify-comment.js` — 메인 파이프라인 (slug 추출 → 포스트·작성자 조회 → AI 분석 → 알림 Issue)
- `scripts/config.js` — 저장소·모더레이터·모델·경로 설정
- `scripts/ai-analyzer.js` + `prompts.js` — Gemini 분석
- `scripts/templates.js` — ko/en 알림 본문 템플릿
- `scripts/github-api.js` — 댓글 삭제
- `scripts/metrics.js` — 월별 통계 Issue
- `scripts/utils.js` — 공통 헬퍼
- `.github/workflows/notify-comment.yml` — 트리거 + 실행

## 라이선스

MIT — 원작: [oy-techblog/tech-blog-comment](https://github.com/oy-techblog/tech-blog-comment) (MIT), kese 용도로 각색.
