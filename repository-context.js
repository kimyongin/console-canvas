// Browser code cannot inspect Git or resolve symlinks. This identifies a local
// agent's stated Git result, and labels its provenance instead of asserting OS proof.
export async function agentRepositoryContext(value, repositoryPath) {
  const validPath = (path) =>
    typeof path === 'string' &&
    path.length <= 4096 &&
    path.startsWith('/') &&
    !/[\x00-\x1f]/.test(path) &&
    !path.split('/').some((part) => part === '.' || part === '..');
  if (
    !value ||
    !validPath(value.root) ||
    !validPath(value.common_dir) ||
    value.root !== repositoryPath ||
    value.method !== 'git_rev_parse'
  )
    throw Error('로컬 에이전트가 확인한 Git root/common-dir와 확인 방법이 필요합니다.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.common_dir));
  const identity = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
  if (value.identity && value.identity !== identity)
    throw Error('저장소 식별 정보가 일치하지 않습니다.');
  return {
    identity,
    root: value.root,
    common_dir: value.common_dir,
    verification: {
      by: 'local_agent',
      method: 'git_rev_parse',
      browser_filesystem_verified: false,
    },
  };
}
