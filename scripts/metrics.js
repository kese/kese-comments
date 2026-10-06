const config = require('./config');

/**
 * 월별 metrics Issue에 댓글 알림 이벤트를 기록한다.
 *
 * @param {import('@octokit/rest').Octokit} blogGithub - kesekr 접근용 Octokit
 * @param {Object} eventData
 * @param {string} eventData.postTitle
 * @param {string} eventData.commenter
 * @param {boolean} eventData.notified - GitHub ID가 있어 알림 전달 여부
 * @param {string|null} eventData.category - AI 분류
 * @param {string|null} eventData.sentiment
 * @param {number} eventData.toxicityLevel
 * @param {boolean} eventData.commentDeleted - 자동 삭제 여부
 */
async function recordMetrics(blogGithub, eventData) {
  const { OWNER, REPO } = config.GITHUB;
  const { LABEL, TITLE_PREFIX } = config.METRICS;

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const expectedTitle = `${TITLE_PREFIX} ${yearMonth} 댓글 알림 통계`;

  try {
    // 월별 metrics Issue 검색
    const { data: searchResults } = await blogGithub.rest.search.issuesAndPullRequests({
      q: `repo:${OWNER}/${REPO} is:issue is:open label:${LABEL} "${expectedTitle}"`
    });

    let issueNumber;

    if (searchResults.total_count > 0) {
      issueNumber = searchResults.items[0].number;
      console.log(`📊 Found existing metrics issue #${issueNumber}`);
    } else {
      // 새 Issue 생성
      const { data: newIssue } = await blogGithub.rest.issues.create({
        owner: OWNER,
        repo: REPO,
        title: expectedTitle,
        body: `# 📊 ${yearMonth} 댓글 알림 통계\n\n이 Issue는 자동으로 생성되었습니다. 각 댓글 알림 이벤트가 댓글로 기록됩니다.\n\n---\n\n> 집계는 \`<!-- metrics-json:... -->\` 주석을 파싱하여 수행할 수 있습니다.`,
        labels: [LABEL],
        assignees: config.MODERATORS
      });
      issueNumber = newIssue.number;
      console.log(`📊 Created new metrics issue #${issueNumber}`);
    }

    // 이벤트 댓글 추가
    const timestamp = now.toISOString();
    const notifiedIcon = eventData.notified ? '✅' : '❌ (GitHub ID 없음)';
    const deletedIcon = eventData.commentDeleted ? '✅' : '❌';

    const jsonPayload = JSON.stringify({
      notified: eventData.notified,
      category: eventData.category,
      sentiment: eventData.sentiment,
      toxicityLevel: eventData.toxicityLevel,
      commentDeleted: eventData.commentDeleted,
      timestamp
    });

    const commentBody = `### 📊 Event: ${timestamp}

| 항목 | 값 |
|------|-----|
| 포스트 | ${eventData.postTitle} |
| 댓글 작성자 | ${eventData.commenter} |
| 작성자 알림 | ${notifiedIcon} |
| AI 분류 | ${eventData.category || 'N/A'} |
| 독성 레벨 | ${eventData.toxicityLevel ?? 'N/A'} |
| 자동 삭제 | ${deletedIcon} |

<!-- metrics-json:${jsonPayload} -->`;

    await blogGithub.rest.issues.createComment({
      owner: OWNER,
      repo: REPO,
      issue_number: issueNumber,
      body: commentBody
    });

    console.log(`📊 Metrics event recorded on issue #${issueNumber}`);
  } catch (error) {
    // 메트릭 기록 실패는 알림 프로세스를 중단시키지 않는다
    console.error('⚠️  Failed to record metrics:', error.message);
  }
}

module.exports = { recordMetrics };
