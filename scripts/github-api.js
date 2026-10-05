/**
 * GitHub API 작업 모듈
 */

/**
 * GitHub REST API를 사용하여 댓글 완전 삭제 (Level 5용)
 */
async function deleteComment(github, context) {
  try {
    console.log('🗑️  Deleting severely toxic comment...');

    // Issue comment인 경우에만 삭제 가능
    if (!context.payload.comment) {
      console.log('⚠️  Cannot delete Issue body. Only reply comments can be deleted.');
      return false;
    }

    const commentId = context.payload.comment.id;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    await github.rest.issues.deleteComment({
      owner,
      repo,
      comment_id: commentId
    });

    console.log('✅ Comment successfully deleted');
    return true;
  } catch (error) {
    console.error('❌ Failed to delete comment:', error.message);
    // 삭제 실패해도 알림은 계속 진행
    return false;
  }
}

module.exports = { deleteComment };
