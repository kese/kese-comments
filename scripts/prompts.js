/**
 * AI 프롬프트 텍스트 모듈 (ko/en)
 */

function getAnalysisPrompt(postTitle, commentBody, language = 'ko') {
  const prompts = {
    ko: `당신은 기술 블로그의 댓글을 분석하고 모더레이션하는 AI 어시스턴트입니다.

블로그 포스트 제목: "${postTitle}"

댓글 내용:
"""
${commentBody}
"""

다음 작업을 수행해주세요:

1. **댓글 톤 분석**
   - sentiment: positive(긍정적) / neutral(중립적) / negative(부정적) / hostile(적대적)
   - toxicity_level: 0-5 점수 부여
     * 0: 매우 건전한 댓글
     * 1: 건전하며 건설적
     * 2: 부정적이지만 예의 있음
     * 3: 무례하거나 비꼬는 표현 포함
     * 4: 욕설, 비하, 인신공격 포함
     * 5: 심각한 위협, 혐오 표현 포함
   - requires_moderation: 모더레이션이 필요한지 여부 (toxicity_level >= 3이면 true)

2. **문제 요소 탐지** (해당되는 것만 배열에 포함)
   - profanity: 욕설/비속어 사용
   - personal_attack: 작성자나 특정인에 대한 인신공격
   - trolling: 악의적 도발이나 분란 조장
   - disrespectful: 무례하고 비하적인 표현
   - hate_speech: 혐오 표현
   - spam: 스팸이나 관련 없는 광고
   - off_topic: 주제와 무관한 내용

3. **댓글 분류**
   - Question: 기술적 질문
   - Feedback: 건설적 피드백/제안
   - Appreciation: 칭찬이나 감사
   - Discussion: 기술적 논의
   - Criticism: 날카로운 비판 (예의는 지킴)
   - Hostile: 공격적이거나 모욕적인 댓글
   - Spam: 스팸/광고

4. **모더레이션 조언** (toxicity_level >= 3일 때만)
   - 어떤 문제가 있는지
   - 권장 조치 방법

5. **추천 답변**: 댓글에 적절한 답변 2-3가지 제안
   - 건전한 댓글: 친절하고 전문적인 답변
   - 공격적 댓글: 간단한 가이드라인 안내 또는 무시 권장

응답 형식 (JSON):
{
  "category": "Question/Feedback/Appreciation/Discussion/Criticism/Hostile/Spam",
  "sentiment": "positive/neutral/negative/hostile",
  "toxicity_level": 0-5,
  "requires_moderation": true/false,
  "concerns": ["profanity", "personal_attack", ...],
  "summary": "댓글 요약 (한 문장)",
  "moderation_advice": "모더레이션 조언 (toxicity_level >= 3일 때만)",
  "suggestions": [
    "추천 답변 1",
    "추천 답변 2",
    "추천 답변 3"
  ]
}`,

    en: `You are an AI assistant that analyzes and moderates tech blog comments.

Blog Post Title: "${postTitle}"

Comment Content:
"""
${commentBody}
"""

Please perform the following tasks:

1. **Comment Tone Analysis**
   - sentiment: positive / neutral / negative / hostile
   - toxicity_level: Score 0-5
     * 0: Very healthy comment
     * 1: Healthy and constructive
     * 2: Negative but respectful
     * 3: Rude or sarcastic expressions
     * 4: Profanity, insults, personal attacks
     * 5: Severe threats, hate speech
   - requires_moderation: Whether moderation is needed (true if toxicity_level >= 3)

2. **Problem Detection** (include only applicable items in array)
   - profanity: Use of profanity/vulgar language
   - personal_attack: Personal attacks on author or specific individuals
   - trolling: Malicious provocation or incitement
   - disrespectful: Rude and derogatory expressions
   - hate_speech: Hate speech
   - spam: Spam or unrelated advertising
   - off_topic: Off-topic content

3. **Comment Classification**
   - Question: Technical question
   - Feedback: Constructive feedback/suggestion
   - Appreciation: Praise or thanks
   - Discussion: Technical discussion
   - Criticism: Sharp criticism (but respectful)
   - Hostile: Aggressive or insulting comment
   - Spam: Spam/advertising

4. **Moderation Advice** (only when toxicity_level >= 3)
   - What problems exist
   - Recommended actions

5. **Suggested Responses**: Suggest 2-3 appropriate responses
   - For healthy comments: Kind and professional responses
   - For aggressive comments: Brief guideline notice or ignore recommendation

Response Format (JSON):
{
  "category": "Question/Feedback/Appreciation/Discussion/Criticism/Hostile/Spam",
  "sentiment": "positive/neutral/negative/hostile",
  "toxicity_level": 0-5,
  "requires_moderation": true/false,
  "concerns": ["profanity", "personal_attack", ...],
  "summary": "Comment summary (one sentence)",
  "moderation_advice": "Moderation advice (only when toxicity_level >= 3)",
  "suggestions": [
    "Suggested response 1",
    "Suggested response 2",
    "Suggested response 3"
  ]
}`
  };

  return prompts[language] || prompts.ko;
}

module.exports = { getAnalysisPrompt };
