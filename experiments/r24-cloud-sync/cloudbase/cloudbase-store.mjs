import {readEnrollment} from './cloudbase-identity.mjs';

const pageSize = 10;
const maxPages = 100;
const maxResultBytes = 8 * 1024 * 1024;

async function resultRows(query) {
  const response = await query;
  if (response?.error || !Array.isArray(response?.data)) {
    throw new Error('CloudBase PostgreSQL request failed');
  }
  return response.data;
}

function enrollment(row) {
  if (!row) return null;
  return {
    _id: row.id, teamId: row.team_id, displayName: row.display_name,
    role: row.role, active: row.active,
  };
}

function payload(row) {
  if (row?.payload?.id !== row.id) throw new Error('Invalid CloudBase PostgreSQL record');
  return row.payload;
}

export function createDatabaseAdapter(db, prefix) {
  const enrollments = `${prefix}_enrollments`;
  const assignments = `${prefix}_assignments`;
  const submissions = `${prefix}_submissions`;
  const claims = `${prefix}_claims`;
  const submissionAudio = `${prefix}_submission_audio`;
  const audioFields = 'id,assignment_id,submission_id,question_id,team_id,anchor_id,mime_type,bytes,sha256,object_path,ready_at';

  function fromAudio(row) {
    if (!row) return null;
    return {
      id: row.id, assignmentId: row.assignment_id, submissionId: row.submission_id,
      questionId: row.question_id, teamId: row.team_id, anchorId: row.anchor_id,
      mimeType: row.mime_type, bytes: row.bytes, sha256: row.sha256,
      objectPath: row.object_path, readyAt: row.ready_at,
    };
  }

  function queryFrom(table, fields, filter) {
    let query = db.from(table).select(fields);
    for (const [column, value] of Object.entries(filter)) query = query.eq(column, value);
    return query;
  }

  async function getRow(table, fields, id) {
    const rows = await resultRows(queryFrom(table, fields, {id}).limit(1));
    return rows[0] ?? null;
  }

  async function pageById(table, fields, filter) {
    const result = [];
    let cursor = null;
    let accumulatedBytes = 0;
    for (let page = 0; page < maxPages; page++) {
      let query = queryFrom(table, fields, filter).order('id', {ascending: true}).limit(pageSize);
      if (cursor !== null) query = query.gt('id', cursor);
      const batch = await resultRows(query);
      if (batch.length > pageSize) throw new Error('Invalid PostgreSQL page size');
      for (const row of batch) {
        if (typeof row?.id !== 'string' || !row.id || (cursor !== null && row.id <= cursor)) {
          throw new Error('Invalid PostgreSQL cursor');
        }
        accumulatedBytes += Buffer.byteLength(JSON.stringify(row));
        if (accumulatedBytes > maxResultBytes) throw new Error('CloudBase result exceeded the pilot size limit');
        cursor = row.id;
      }
      result.push(...batch);
      if (batch.length < pageSize) return result;
    }
    throw new Error('CloudBase result exceeded the pilot pagination limit');
  }

  async function getRecord(table, id) {
    const row = await getRow(table, 'id,payload', id);
    return row ? payload(row) : null;
  }

  async function insertRecord(table, row) {
    // INSERT is atomic on the primary key. No update/upsert permission is required.
    const result = await db.from(table).insert(row).select('id');
    if (result?.error?.code === '23505') return false;
    if (result?.error || result?.data?.length !== 1 || result.data[0]?.id !== row.id) {
      throw new Error('CloudBase PostgreSQL did not confirm record insert');
    }
    return true;
  }

  const enrollmentCols = 'id,team_id,display_name,role,active';
  return {
    getEnrollment: async uid => enrollment(await getRow(enrollments, enrollmentCols, uid)),
    directory: {
      listAnchors: async teamId => (await pageById(
        enrollments, enrollmentCols, {team_id: teamId, role: 'anchor', active: true},
      )).map(row => readEnrollment(enrollment(row))).filter(Boolean),
    },
    store: {
      getAssignment: id => getRecord(assignments, id),
      createAssignment: record => insertRecord(assignments, {
        id: record.id, team_id: record.teamId, payload: record,
      }),
      listAssignments: async teamId => (await pageById(assignments, 'id,payload', {team_id: teamId})).map(payload),
      getSubmission: id => getRecord(submissions, id),
      createSubmission: record => insertRecord(submissions, {
        id: record.id, team_id: record.teamId, assignment_id: record.assignmentId,
        anchor_id: record.anchorId, submitted_at: record.submittedAt, payload: record,
      }),
      listSubmissions: async (assignmentId, teamId, anchorId) => (await pageById(
        submissions, 'id,payload', {
          assignment_id: assignmentId, team_id: teamId, ...(anchorId ? {anchor_id: anchorId} : {}),
        },
      )).map(payload),
      listAssignmentSubmissionStatuses: async (assignmentId, teamId) => (await pageById(
        submissions, 'id,anchor_id,submitted_at,payload->>anchorName', {assignment_id: assignmentId, team_id: teamId},
      )).map(row => ({anchorId: row.anchor_id, anchorName: row.anchorName, submittedAt: new Date(row.submitted_at).toISOString()})),
      getClaim: id => getRecord(claims, id),
      createClaim: record => insertRecord(claims, {
        id: record.id, team_id: record.teamId, assignment_id: record.assignmentId,
        anchor_id: record.anchorId, payload: record,
      }),
      listClaims: async (assignmentId, teamId) => (await pageById(
        claims, 'id,payload', {assignment_id: assignmentId, team_id: teamId},
      )).map(payload),
      listAnchorClaims: async (teamId, anchorId) => (await pageById(
        claims, 'id,payload', {team_id: teamId, anchor_id: anchorId},
      )).map(payload),
      getAudio: async id => fromAudio(await getRow(submissionAudio, audioFields, id)),
      createAudio: record => insertRecord(submissionAudio, {
        id: record.id, assignment_id: record.assignmentId, submission_id: record.submissionId,
        question_id: record.questionId, team_id: record.teamId, anchor_id: record.anchorId,
        mime_type: record.mimeType, bytes: record.bytes, sha256: record.sha256,
        object_path: record.objectPath,
      }),
      async markAudioReady(id, readyAt) {
        const records = await resultRows(db.from(submissionAudio).update({ready_at: readyAt})
          .eq('id', id).is('ready_at', null).select(audioFields));
        if (records.length > 1) throw new Error('Unexpected audio update result');
        return fromAudio(records[0] ?? await getRow(submissionAudio, audioFields, id));
      },
      listSubmissionAudio: async (assignmentId, teamId, anchorId) => (await pageById(
        submissionAudio, audioFields, {
          assignment_id: assignmentId, team_id: teamId, ...(anchorId ? {anchor_id: anchorId} : {}),
        },
      )).map(fromAudio),
      listAnchorSubmissionStatuses: async (teamId, anchorId) => (await pageById(
        submissions, 'id,assignment_id,submitted_at', {team_id: teamId, anchor_id: anchorId},
      )).map(row => ({assignmentId: row.assignment_id, submittedAt: new Date(row.submitted_at).toISOString()})),
    },
  };
}
