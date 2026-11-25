/** Process-local test store. This intentionally has no cross-device persistence. */
export function createMemoryStore() {
  const assignments = new Map();
  const submissions = new Map();
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
    async getSubmission(id) {
      return structuredClone(submissions.get(id));
    },
    async createSubmission(record) {
      return insertIfAbsent(submissions, record);
    },
    async listSubmissions(assignmentId, teamId, anchorId) {
      return structuredClone([...submissions.values()]
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
    async listSubmissionAudio(assignmentId, teamId, anchorId) {
      return structuredClone([...audio.values()]
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
