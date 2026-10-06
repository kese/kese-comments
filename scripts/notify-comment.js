#!/usr/bin/env node

const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { formatAsBlockquote, formatModerators, getSeverityLabel, isModerationRequired, isAutoDelete } = require('./utils');
const { getNotificationMessages } = require('./templates');
const { deleteComment } = require('./github-api');
const { analyzeCommentWithAI } = require('./ai-analyzer');
const { recordMetrics } = require('./metrics');

// utterances 댓글 -> 작성자 알림 파이프라인 (sof.kr / kese 블로그).
// Adapted from oy-techblog/tech-blog-comment (MIT).
//
// GitHub Actions: actions/github-script가 (context, github)를 넘겨 호출.
// 로컬 테스트: ISSUE_NUMBER=1 node scripts/notify-comment.js
//   - 읽기 전용 dry-run: 토큰 불필요 (이 저장소는 public)
//   - 실제 알림 Issue 생성: BLOG_ACCESS_TOKEN + ENABLE_NOTIFICATION=true

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? yaml.load(match[1]) : null;
}

// content/posts/<slug>/index.md 를 먼저 찾고, 없으면 모든 포스트의
// frontmatter slug 필드를 대조한다.
function findPostFile(blogPath, slug) {
  const postsDir = path.join(blogPath, config.POSTS_DIR);
  const direct = path.join(postsDir, slug, 'index.md');
  if (fs.existsSync(direct)) return direct;
  const flat = path.join(postsDir, slug + '.md');
  if (fs.existsSync(flat)) return flat;
  if (!fs.existsSync(postsDir)) return null;
  for (const entry of fs.readdirSync(postsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(postsDir, entry.name, 'index.md');
    if (!fs.existsSync(candidate)) continue;
    const fm = parseFrontmatter(fs.readFileSync(candidate, 'utf8'));
    if (fm && fm.slug === slug) return candidate;
  }
  return null;
}

// content/authors.yaml 항목: { id, name, github }
function findAuthor(blogPath, authorId) {
  const authorsPath = path.join(blogPath, config.AUTHORS_FILE);
  if (!fs.existsSync(authorsPath)) return null;
  const authors = yaml.load(fs.readFileSync(authorsPath, 'utf8')) || [];
  return authors.find((a) => a && a.id === authorId) || null;
}

async function notify(context, github) {
  console.log('=== Comment notification start ===');

  const issueTitle = context.payload.issue.title;
  console.log('Issue title:', issueTitle);

  // utterances issue-term=pathname 이므로 제목은 "/blog/<slug>/" 형태다.
  const match = issueTitle.match(config.POST_PATTERN);
  if (!match) {
    console.log('❌ Could not extract post slug from issue title');
    console.log('   Expected "/blog/<slug>/" or a full https://sof.kr/blog/<slug>/ URL');
    return;
  }
  const postSlug = match[1];
  console.log('✅ Extracted slug:', postSlug);

  // GitHub Actions에서는 kesekr가 'blog' 경로에 체크아웃된다.
  // 로컬에서는 BLOG_PATH 또는 ../kesekr 를 사용한다.
  let blogPath = process.env.BLOG_PATH;
  if (!blogPath) {
    blogPath = !process.env.GITHUB_ACTIONS && fs.existsSync('../kesekr') ? '../kesekr' : 'blog';
  }
  console.log('📁 Blog path:', blogPath);

  const postPath = findPostFile(blogPath, postSlug);
  if (!postPath) {
    console.log('❌ Post not found for slug:', postSlug);
    console.log('   Looked under:', path.join(blogPath, config.POSTS_DIR));
    return;
  }
  console.log('📄 Post file:', postPath);

  const frontmatter = parseFrontmatter(fs.readFileSync(postPath, 'utf8'));
  if (!frontmatter) {
    console.log('❌ No frontmatter found in post');
    return;
  }

  let postLanguage = (frontmatter.language || 'ko').toLowerCase();
  if (!['ko', 'en'].includes(postLanguage)) {
    console.log('⚠️  Unknown language: ' + postLanguage + ', defaulting to ko');
    postLanguage = 'ko';
  }

  const authorId = frontmatter.author || 'kese';
  const author = findAuthor(blogPath, authorId);
  const authorName = author ? author.name : authorId;
  const hasGithubId = !!(author && author.github);

  console.log('✅ Author id:', authorId, '| language:', postLanguage);
  if (hasGithubId) {
    console.log('✅ Author GitHub:', author.github);
  } else {
    console.log('⚠️  No GitHub id mapped for author', authorId);
  }

  // 댓글 정보 (issue_comment 이벤트면 comment, issues.opened면 issue 본문)
  const commenter = context.payload.comment?.user.login || context.payload.issue.user.login;
  const commentUrl = context.payload.comment?.html_url || context.payload.issue.html_url;
  const commentBody = context.payload.comment?.body || context.payload.issue.body || '';
  const isNewIssue = !context.payload.comment;
  const isComment = !!context.payload.comment;

  // AI 댓글 분석 (GEMINI_API_KEY 없으면 null 반환)
  const aiAnalysis = await analyzeCommentWithAI(commentBody, frontmatter.title, postLanguage);

  const { MODERATORS } = config;

  // Level 4+ 악성 댓글 자동 삭제 (증거는 알림 Issue에 보존)
  let commentDeleted = false;
  if (isAutoDelete(aiAnalysis)) {
    console.log('⚠️  High toxicity detected (level ' + aiAnalysis.toxicity_level + ')');
    if (!isComment) {
      console.log('⚠️  Issue bodies cannot be deleted via API - delete it manually');
    } else {
      console.log('🗑️  Deleting toxic comment...');
      commentDeleted = await deleteComment(github, context);
      console.log('Delete result:', commentDeleted ? 'SUCCESS' : 'FAILED');
    }
  }

  let notificationTitle, notificationBody, labels;
  const emoji = isNewIssue ? '🎉' : '💬';

  if (!hasGithubId) {
    // GitHub ID 미매칭 fallback 알림
    console.log('⚠️  Creating fallback notification for unmapped author');

    let aiSection = '';
    if (aiAnalysis) {
      const toxicityWarning = isModerationRequired(aiAnalysis)
        ? `\n\n⚠️ **Toxicity Level ${aiAnalysis.toxicity_level}** - ${postLanguage === 'en' ? 'Moderation may be required' : '모더레이션이 필요할 수 있습니다'}.\n**${postLanguage === 'en' ? 'Issues' : '문제점'}:** ${aiAnalysis.concerns?.join(', ') || 'N/A'}`
        : '';

      aiSection = `
---

### 🤖 ${postLanguage === 'en' ? 'AI Comment Analysis' : 'AI 댓글 분석'}

**${postLanguage === 'en' ? 'Category' : '분류'}:** ${aiAnalysis.category}
**${postLanguage === 'en' ? 'Summary' : '요약'}:** ${aiAnalysis.summary}${toxicityWarning}

**${postLanguage === 'en' ? 'Suggested Responses' : '추천 답변'}:**
${aiAnalysis.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n\n')}`;
    }

    const messages = getNotificationMessages(postLanguage, 'fallback', {
      title: frontmatter.title,
      commentUrl,
      authorName,
      writerId: authorId,
      commenter,
      commentBody: formatAsBlockquote(commentBody),
      aiSection,
      moderators: formatModerators(MODERATORS)
    });

    notificationTitle = messages.title;
    notificationBody = messages.body;
    labels = ['notification', 'missing-github-id', 'action-required'];

  } else if (isModerationRequired(aiAnalysis)) {
    // Level 3+ 모더레이션 필요 알림
    const toxicityEmoji = isAutoDelete(aiAnalysis) ? '🚨' : '⚠️';
    const severityLabel = getSeverityLabel(aiAnalysis.toxicity_level);
    const deletedMessage = commentDeleted
      ? `🗑️ **${postLanguage === 'en' ? 'This comment has been automatically deleted.' : '이 댓글은 자동으로 삭제되었습니다.'}** (${postLanguage === 'en' ? 'Evidence preserved in this notification' : '증거는 이 알림에 보존됨'})\n`
      : '';

    const suggestions = isAutoDelete(aiAnalysis)
      ? (postLanguage === 'en'
        ? `**1️⃣ Immediate Action (Recommended)
- ${commentDeleted ? '✅ Comment already deleted automatically' : '⚠️ Deletion recommended'}
- Consider blocking user if repeated
- Review GitHub Abuse Report for severe cases

**2️⃣ Additional Monitoring**
- Check other comments from same user
- Analyze patterns and keep records`
        : `**1️⃣ 즉시 조치 (권장)**
- ${commentDeleted ? '✅ 댓글이 이미 자동 삭제되었습니다' : '⚠️ 댓글 삭제를 권장합니다'}
- 반복되는 경우 사용자 차단 고려
- 심각한 경우 GitHub Abuse Report 검토

**2️⃣ 추가 모니터링**
- 동일 사용자의 다른 댓글 확인
- 패턴 분석 및 기록 보관`)
      : (postLanguage === 'en'
        ? `**1️⃣ Careful Response**
- Address only technical points briefly
- Maintain professional and neutral tone
- Do not escalate to an argument

**2️⃣ Guideline Notice**
- "We welcome constructive feedback"
- Provide community guidelines link

**3️⃣ Ignore**
- Hide comment and do not respond`
        : `**1️⃣ 신중한 답변**
- 기술적 논점만 간단히 응대
- 전문적이고 중립적인 톤 유지
- 논쟁으로 확대하지 않기

**2️⃣ 가이드라인 안내**
- "건설적인 피드백을 환영합니다"
- 커뮤니티 가이드라인 링크 제공

**3️⃣ 무시**
- 댓글 숨김 후 답변하지 않기`);

    const messages = getNotificationMessages(postLanguage, 'toxic', {
      emoji: toxicityEmoji,
      title: frontmatter.title,
      commentUrl,
      commenter,
      toxicityLevel: aiAnalysis.toxicity_level,
      severityLabel,
      concerns: aiAnalysis.concerns?.join(', ') || 'N/A',
      deletedMessage,
      commentBody: formatAsBlockquote(commentBody),
      category: aiAnalysis.category,
      summary: aiAnalysis.summary,
      suggestions,
      moderators: formatModerators(MODERATORS)
    });

    notificationTitle = messages.title;
    notificationBody = messages.body;
    labels = ['notification', 'moderation', isAutoDelete(aiAnalysis) ? 'urgent' : 'warning'];

  } else {
    // 일반 알림 (toxicity level 0-2 또는 AI 미설정)
    let aiSection = '';
    if (aiAnalysis) {
      aiSection = `
---

### 🤖 ${postLanguage === 'en' ? 'AI Comment Analysis' : 'AI 댓글 분석'}

**${postLanguage === 'en' ? 'Category' : '분류'}:** ${aiAnalysis.category}
**${postLanguage === 'en' ? 'Summary' : '요약'}:** ${aiAnalysis.summary}

**${postLanguage === 'en' ? 'Suggested Responses' : '추천 답변'}:**
${aiAnalysis.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n\n')}`;
    }

    const actionText = isNewIssue
      ? (postLanguage === 'en' ? 'a new comment was posted' : '새로운 댓글이 달렸습니다')
      : (postLanguage === 'en' ? 'a comment was added' : '댓글이 추가되었습니다');

    const messages = getNotificationMessages(postLanguage, 'normal', {
      emoji,
      github: author.github,
      action: actionText,
      commentUrl,
      title: frontmatter.title,
      commenter,
      commentBody: formatAsBlockquote(commentBody),
      aiSection
    });

    notificationTitle = messages.title;
    notificationBody = messages.body;
    labels = ['notification', 'comment'];
  }

  // kesekr 저장소에서 기존 알림 Issue 검색
  const blogOwner = config.GITHUB.OWNER;
  const blogRepo = config.GITHUB.REPO;

  console.log('🔍 Checking for existing notification issue...');

  const { Octokit } = require('@octokit/rest');
  const blogToken = process.env.BLOG_ACCESS_TOKEN;
  if (!blogToken) {
    throw new Error('BLOG_ACCESS_TOKEN is required for creating notification issues');
  }
  const blogGithub = new Octokit({ auth: blogToken });

  const searchQuery = `repo:${blogOwner}/${blogRepo} is:issue is:open label:notification "${frontmatter.title}"`;

  try {
    const { data: searchResults } = await blogGithub.rest.search.issuesAndPullRequests({
      q: searchQuery
    });

    if (searchResults.total_count > 0) {
      // 같은 포스트 알림 Issue가 있으면 댓글 추가
      const existingIssue = searchResults.items[0];
      console.log('✅ Found existing notification issue:', existingIssue.html_url);

      let newCommentBody;

      if (isModerationRequired(aiAnalysis)) {
        const toxicityEmoji = isAutoDelete(aiAnalysis) ? '🚨' : '⚠️';
        const severityLabel = getSeverityLabel(aiAnalysis.toxicity_level);

        newCommentBody = `${toxicityEmoji} **부적절한 댓글이 추가되었습니다**: [보기](${commentUrl})

**댓글 작성자:** ${commenter}
**위험도:** Level ${aiAnalysis.toxicity_level} (${severityLabel})
**문제점:** ${aiAnalysis.concerns?.join(', ') || 'N/A'}

### 📋 댓글 내용
> ${formatAsBlockquote(commentBody)}

${commentDeleted ? '🗑️ **이 댓글은 자동으로 삭제되었습니다.** (증거는 이 알림에 보존됨)' : ''}

### 🤖 AI 분석
**분류:** ${aiAnalysis.category} | **감정:** ${aiAnalysis.sentiment}
**요약:** ${aiAnalysis.summary}

${aiAnalysis.moderation_advice ? `**조언:** ${aiAnalysis.moderation_advice}` : ''}

---
**관리자:** ${formatModerators(MODERATORS)}`;

        const currentLabels = existingIssue.labels.map(l => typeof l === 'string' ? l : l.name);
        const newLabels = [...new Set([...currentLabels, 'moderation', isAutoDelete(aiAnalysis) ? 'urgent' : 'warning'])];

        await blogGithub.rest.issues.update({
          owner: blogOwner,
          repo: blogRepo,
          issue_number: existingIssue.number,
          labels: newLabels
        });

      } else {
        let aiSection = '';
        if (aiAnalysis) {
          aiSection = `
---

### 🤖 AI 댓글 분석

**분류:** ${aiAnalysis.category}
**요약:** ${aiAnalysis.summary}

**추천 답변:**
${aiAnalysis.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n\n')}`;
        }

        newCommentBody = `${emoji} 새로운 댓글이 추가되었습니다: [보기](${commentUrl})

**댓글 작성자:** ${commenter}

**댓글 내용:**
> ${formatAsBlockquote(commentBody)}${aiSection}`;
      }

      await blogGithub.rest.issues.createComment({
        owner: blogOwner,
        repo: blogRepo,
        issue_number: existingIssue.number,
        body: newCommentBody
      });

      console.log('✅ Comment added to existing issue #' + existingIssue.number);
    } else {
      // 알림 Issue가 없으면 새로 생성
      console.log('📝 No existing issue found, creating new one...');

      await blogGithub.rest.issues.create({
        owner: blogOwner,
        repo: blogRepo,
        title: notificationTitle,
        body: notificationBody,
        labels: labels
      });

      console.log('✅ Notification issue created in', `${blogOwner}/${blogRepo}`);
    }

    // 메트릭 기록
    await recordMetrics(blogGithub, {
      postTitle: frontmatter.title,
      commenter,
      notified: hasGithubId,
      category: aiAnalysis?.category || null,
      sentiment: aiAnalysis?.sentiment || null,
      toxicityLevel: aiAnalysis?.toxicity_level ?? 0,
      commentDeleted,
    });

    console.log('=== Process completed ===');
  } catch (error) {
    console.error('❌ Error handling notification:', error.message);
    throw error;
  }
}

// 로컬 테스트용 main (ISSUE_NUMBER 환경변수)
async function main() {
  if (process.env.ISSUE_NUMBER && !process.env.GITHUB_ACTIONS) {
    console.log('🧪 Local test mode');

    const { Octokit } = require('@octokit/rest');
    const issueNumber = parseInt(process.env.ISSUE_NUMBER);

    // 이 저장소는 public이므로 토큰 없이 읽기 가능
    const octokitPublic = new Octokit();

    let octokitAuth = null;
    const token = process.env.BLOG_ACCESS_TOKEN || process.env.GITHUB_TOKEN;
    if (token) {
      octokitAuth = new Octokit({ auth: token.trim() });
      console.log('✅ BLOG_ACCESS_TOKEN configured');
    } else {
      console.log('⚠️  BLOG_ACCESS_TOKEN not set (dry-run mode)');
    }

    const owner = process.env.COMMENTS_OWNER || 'kese';
    const repo = process.env.COMMENTS_REPO || 'kese-comments';

    console.log(`Fetching issue #${issueNumber} from ${owner}/${repo}`);

    const { data: issue } = await octokitPublic.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber
    });

    const { data: comments } = await octokitPublic.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 1,
      sort: 'created',
      direction: 'desc'
    });

    const context = {
      payload: {
        issue: issue,
        comment: comments.length > 0 ? comments[0] : null
      },
      repo: { owner, repo }
    };

    const github = {
      rest: {
        issues: {
          deleteComment: async ({ owner, repo, comment_id }) => {
            console.log('🗑️  Would delete comment', comment_id);
            if (octokitAuth && process.env.ENABLE_NOTIFICATION === 'true') {
              return await octokitAuth.rest.issues.deleteComment({ owner, repo, comment_id });
            }
          }
        },
        search: {
          issuesAndPullRequests: async ({ q }) => {
            console.log('🔍 Search:', q);
            if (octokitAuth) return await octokitAuth.rest.search.issuesAndPullRequests({ q });
            console.log('⚠️  Dry-run: assuming no existing issues');
            return { data: { total_count: 0, items: [] } };
          }
        },
        ...(octokitAuth ? {} : {}),
      }
    };

    await notify(context, github);
  } else {
    console.log('Call from GitHub Actions, or set ISSUE_NUMBER for a local test');
  }
}

module.exports = { notify };

if (require.main === module) {
  main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}
