/** Process-local test store. This intentionally has no cross-device persistence. */
export function createMemoryStore() {
  const assignments = new Map();
  const submissions = new Map();

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
    async listSubmissions(assignmentId, teamId) {
      return structuredClone([...submissions.values()]
        .filter(record => record.assignmentId === assignmentId && record.teamId === teamId));
    },
    async listAnchorSubmissionStatuses(teamId, anchorId) {
      return [...submissions.values()]
        .filter(record => record.teamId === teamId && record.anchorId === anchorId)
        .map(({ assignmentId, submittedAt }) => ({ assignmentId, submittedAt }));
    },
  };
}
