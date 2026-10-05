/**
 * Gemini AI 댓글 분석 모듈
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config');
const { getAnalysisPrompt } = require('./prompts');

/**
 * Gemini API를 사용하여 댓글 분석 및 추천 답변 생성
 */
async function analyzeCommentWithAI(commentBody, postTitle, postLanguage = 'ko') {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log('⚠️  GEMINI_API_KEY not set, skipping AI analysis');
    return null;
  }

  try {
    console.log(`🤖 Analyzing comment with Gemini AI (${postLanguage})...`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: config.GEMINI_MODEL });

    const prompt = getAnalysisPrompt(postTitle, commentBody, postLanguage);

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // JSON 파싱 (코드 블록 제거)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      console.log('✅ AI analysis completed');
      console.log('   Category:', analysis.category);
      console.log('   Sentiment:', analysis.sentiment);
      console.log('   Toxicity Level:', analysis.toxicity_level);
      console.log('   Requires Moderation:', analysis.requires_moderation);
      if (analysis.concerns && analysis.concerns.length > 0) {
        console.log('   Concerns:', analysis.concerns.join(', '));
      }
      return analysis;
    } else {
      console.log('⚠️  Could not parse AI response');
      return null;
    }
  } catch (error) {
    console.error('❌ AI analysis failed:', error.message);
    return null;
  }
}

module.exports = { analyzeCommentWithAI };
