const { TOXICITY } = require('./config');

function formatAsBlockquote(text) {
  return text.split('\n').join('\n> ');
}

function formatModerators(moderators) {
  return moderators.map(m => `@${m}`).join(', ');
}

function getSeverityLabel(level) {
  return level >= TOXICITY.AUTO_DELETE ? 'High' : 'Medium';
}

function isModerationRequired(aiAnalysis) {
  return aiAnalysis && aiAnalysis.toxicity_level >= TOXICITY.MODERATION_REQUIRED;
}

function isAutoDelete(aiAnalysis) {
  return aiAnalysis && aiAnalysis.toxicity_level >= TOXICITY.AUTO_DELETE;
}

module.exports = {
  formatAsBlockquote,
  formatModerators,
  getSeverityLabel,
  isModerationRequired,
  isAutoDelete,
};
