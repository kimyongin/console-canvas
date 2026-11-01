// Copying a request never starts an agent or freezes a work manifest.
export function agentRequest(project, { ticket = null, intent = 'read' } = {}) {
  if (!project?.id) throw Error('프로젝트를 먼저 선택해 주세요.');
  if (!['read', 'design', 'implement'].includes(intent)) throw Error('요청 유형을 확인해 주세요.');
  const scope = `캔버스 프로젝트 ${project.display_id}(${project.name}, ID ${project.id})`;
  const connection = project.repository
    ? `현재 저장소와 ${scope}의 연결을 확인하고, `
    : `현재 저장소를 ${scope}에 연결하고, `;
  const target = ticket ? `${ticket.display_id} 티켓` : '이 프로젝트의 티켓 목록';
  if (intent === 'design')
    return (
      connection +
      `${target}의 화면·주석으로 이미지 시안 3개를 보여줘. 아직 프로젝트 코드는 수정하지 마.`
    );
  if (intent === 'implement')
    return (
      connection +
      (ticket
        ? `${target}의 확정 목표를 구현해줘. 재확정 필요·보류·이미 작업 중이면 착수하지 말고 이유를 알려줘.`
        : '요청 시점에 확정된 미착수 티켓들을 전부 구현해줘. 재확정 필요·보류·작업 중은 제외하고 이유를 알려줘.')
    );
  return connection + `${target}을 가져와. 조회만 해줘.`;
}
