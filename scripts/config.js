module.exports = {
  // Single-author blog: the post author is also the moderator.
  MODERATORS: (process.env.MODERATORS || 'kese')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
  TOXICITY: {
    MODERATION_REQUIRED: 3,
    AUTO_DELETE: 4,
  },
  // Notification issues are created in the (private) blog repository.
  GITHUB: {
    OWNER: process.env.BLOG_OWNER || 'kese',
    REPO: process.env.BLOG_REPO || 'kese-blog',
  },
  // utterances issue-term is pathname, so issue titles look like
  // "/blog/<slug>/" (full https://sof.kr/blog/<slug>/ URLs also match).
  POST_PATTERN: /\/blog\/([A-Za-z0-9_-]+)/,
  POSTS_DIR: 'content/posts',
  AUTHORS_FILE: 'content/authors.yaml',
  METRICS: {
    LABEL: 'metrics',
    TITLE_PREFIX: '[Metrics]',
  },
};
