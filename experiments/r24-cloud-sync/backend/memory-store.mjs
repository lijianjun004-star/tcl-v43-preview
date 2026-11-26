/** Process-local test store. This intentionally has no cross-device persistence. */
export function createMemoryStore() {
  const assignments = new Map();
  const submissions = new Map();
  const evaluations = new Map();
  const claims = new Map();
  const audio = new Map();

  function insertIfAbsent(records, value) {
    if (records.has(value.id)) return false;
    records.set(value.id, structuredClone(value));
    return true;
  }

  return {
    async getAssignment(id) {
      return structuredClone(assignments.get(id));
    },
    async createAssignment(record) {
      return insertIfAbsent(assignments, record);
    },
    async listAssignments(teamId) {
      return structuredClone([...assignments.values()].filter(record => record.teamId === teamId));
    },
    async getEvaluation(id) { return structuredClone(evaluations.get(id)); },
    async createEvaluation(record) { return insertIfAbsent(evaluations, record); },
    async getSubmission(id) {
      return structuredClone(submissions.get(id));
    },
    async createSubmission(record) {
      return insertIfAbsent(submissions, record);
    },
    async listSubmissionHeaders(assignmentId, teamId, anchorId, cursor, limit) {
      const descending = (a, b) => a === b ? 0 : a > b ? -1 : 1;
      return [...submissions.values()]
        .filter(row => row.assignmentId === assignmentId && row.teamId === teamId && (!anchorId || row.anchorId === anchorId))
        .filter(row => !cursor || row.submittedAt < cursor.time || (row.submittedAt === cursor.time && row.id < cursor.id))
        .sort((a, b) => descending(a.submittedAt, b.submittedAt) || descending(a.id, b.id))
        .slice(0, limit).map(({id, submittedAt}) => ({id, submittedAt}));
    },
    async listSubmissions(assignmentId, teamId, anchorId, ids) {
      return structuredClone([...submissions.values()]
        .filter(record => !ids || ids.includes(record.id))
        .filter(record => record.assignmentId === assignmentId && record.teamId === teamId
          && (!anchorId || record.anchorId === anchorId)));
    },
    async listAssignmentSubmissionStatuses(assignmentId, teamId) {
      return [...submissions.values()]
        .filter(record => record.assignmentId === assignmentId && record.teamId === teamId)
        .map(({ anchorId, anchorName, submittedAt }) => ({ anchorId, anchorName, submittedAt }));
    },
    async getClaim(id) { return structuredClone(claims.get(id)); },
    async createClaim(record) { return insertIfAbsent(claims, record); },
    async listClaims(assignmentId, teamId) {
      return structuredClone([...claims.values()]
        .filter(record => record.assignmentId === assignmentId && record.teamId === teamId));
    },
    async listAnchorClaims(teamId, anchorId) {
      return structuredClone([...claims.values()]
        .filter(record => record.teamId === teamId && record.anchorId === anchorId));
    },
    async getAudio(id) { return structuredClone(audio.get(id)); },
    async createAudio(record) { return insertIfAbsent(audio, record); },
    async markAudioReady(id, readyAt) {
      const record = audio.get(id);
      if (!record) return null;
      record.readyAt ??= readyAt;
      return structuredClone(record);
    },
    async listSubmissionAudio(assignmentId, teamId, anchorId, ids) {
      return structuredClone([...audio.values()]
        .filter(record => !ids || ids.includes(record.submissionId))
        .filter(record => record.assignmentId === assignmentId && record.teamId === teamId
          && (!anchorId || record.anchorId === anchorId)));
    },
    async listAnchorSubmissionStatuses(teamId, anchorId) {
      return [...submissions.values()]
        .filter(record => record.teamId === teamId && record.anchorId === anchorId)
        .map(({ assignmentId, submittedAt }) => ({ assignmentId, submittedAt }));
    },
  };
}
