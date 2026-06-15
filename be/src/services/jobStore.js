import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// On Azure App Service, store the DB outside the deployment directory (/home/site/wwwroot)
// to prevent rsync conflicts during zip-deploy. /home/data persists across deployments.
const isAzureAppService = Boolean(
  process.env.WEBSITE_SITE_NAME || process.env.WEBSITE_INSTANCE_ID
);
const defaultDataDir = isAzureAppService
  ? "/home/data/laureate-hitl"
  : path.join(__dirname, "../data");
const dataDir = process.env.DB_DATA_DIR || defaultDataDir;
const dbPath = path.join(dataDir, "jobs.db");
const legacyJsonPath = path.join(__dirname, "../data", "jobs.json");

// Ensure the data directory exists before SQLite tries to create the DB file.
// On a fresh Azure App Service deploy the directory may not exist yet because
// the runtime-generated .db files are excluded from the deployment package.
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(0);

let db;

let upsertStmt;
let getByIdStmt;
let getBySecondaryIdStmt;
let getAllStmt;
let getByGroupStmt;
let deleteByIdStmt;
let resetStmt;
let countStmt;
let deleteSyntheticStmt;

const SQLITE_MALFORMED_TOKEN = "database disk image is malformed";

const isMalformedDatabaseError = (error) =>
  String(error?.message || "").toLowerCase().includes(SQLITE_MALFORMED_TOKEN);

const ensureDataDirectory = () => {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
};

const backupCorruptedDatabaseFiles = () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifacts = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];

  for (const sourcePath of artifacts) {
    if (!fs.existsSync(sourcePath)) continue;

    const backupPath = `${sourcePath}.corrupt-${stamp}`;
    try {
      fs.renameSync(sourcePath, backupPath);
      console.warn(`Backed up corrupted SQLite artifact to ${backupPath}`);
    } catch (error) {
      // Continue recovery even if backup fails for one artifact.
      console.error(`Failed to back up ${sourcePath}:`, error.message);
    }
  }
};

const initializeDatabase = () => {
  ensureDataDirectory();

  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      student_id TEXT,
      secondary_job_id TEXT,
      group_id TEXT,
      is_off_platform_review INTEGER,
      status TEXT,
      application_status TEXT,
      decision TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_student_id ON jobs(student_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_secondary_job_id ON jobs(secondary_job_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_secondary_job_id_unique
      ON jobs(secondary_job_id)
      WHERE secondary_job_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_jobs_group_id ON jobs(group_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  `);

  upsertStmt = db.prepare(`
    INSERT INTO jobs (
      job_id, student_id, secondary_job_id, group_id, is_off_platform_review,
      status, application_status, decision, payload, created_at, updated_at
    )
    VALUES (
      @job_id, @student_id, @secondary_job_id, @group_id, @is_off_platform_review,
      @status, @application_status, @decision, @payload, @created_at, @updated_at
    )
    ON CONFLICT(job_id) DO UPDATE SET
      student_id = excluded.student_id,
      secondary_job_id = excluded.secondary_job_id,
      group_id = excluded.group_id,
      is_off_platform_review = excluded.is_off_platform_review,
      status = excluded.status,
      application_status = excluded.application_status,
      decision = excluded.decision,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);

  getByIdStmt = db.prepare(`SELECT payload, created_at FROM jobs WHERE job_id = ?`);
  getBySecondaryIdStmt = db.prepare(
    `SELECT payload, created_at FROM jobs WHERE secondary_job_id = ? LIMIT 1`
  );
  getAllStmt = db.prepare(
    `SELECT payload FROM jobs ORDER BY COALESCE(updated_at, created_at) DESC`
  );
  getByGroupStmt = db.prepare(`SELECT payload FROM jobs WHERE group_id = ?`);
  deleteByIdStmt = db.prepare(`DELETE FROM jobs WHERE job_id = ?`);
  resetStmt = db.prepare(`DELETE FROM jobs`);
  countStmt = db.prepare(`SELECT COUNT(1) AS count FROM jobs`);
  deleteSyntheticStmt = db.prepare(
    `DELETE FROM jobs WHERE LOWER(COALESCE(student_id, '')) LIKE 'off-platform-%'`
  );
};

const recoverFromMalformedDatabase = (error) => {
  console.error(`SQLite corruption detected at ${dbPath}:`, error.message);

  try {
    if (db) db.close();
  } catch {
    // Ignore close failures and continue recovery.
  }

  backupCorruptedDatabaseFiles();
  initializeDatabase();
  console.warn("SQLite database was rebuilt after corruption.");
};

const withDbRecovery = (operation) => {
  try {
    return operation();
  } catch (error) {
    if (!isMalformedDatabaseError(error)) {
      throw error;
    }

    recoverFromMalformedDatabase(error);
    return operation();
  }
};

const emitJobUpdate = (type, job) => {
  jobEvents.emit("job:update", {
    type,
    job,
    timestamp: Date.now(),
  });
};

export const getJobEvents = () => jobEvents;

const parsePayload = (row) => {
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
};

const nowIso = () => new Date().toISOString();

const rowFromJob = (job, createdAt = nowIso()) => {
  const safeJob = job && typeof job === "object" ? { ...job } : {};
  const timestamp = nowIso();

  return {
    job_id: String(safeJob.jobId || ""),
    student_id: safeJob.studentId == null ? null : String(safeJob.studentId),
    secondary_job_id:
      safeJob.secondaryJobId == null ? null : String(safeJob.secondaryJobId),
    group_id: safeJob.groupId == null ? null : String(safeJob.groupId),
    is_off_platform_review: safeJob.isOffPlatformReview ? 1 : 0,
    status: safeJob.status == null ? null : String(safeJob.status),
    application_status:
      safeJob.application_status == null ? null : String(safeJob.application_status),
    decision: safeJob.decision == null ? null : String(safeJob.decision),
    payload: JSON.stringify(safeJob),
    created_at: createdAt,
    updated_at: timestamp,
  };
};

const migrateLegacyJsonIfNeeded = () => {
  const total = Number(withDbRecovery(() => countStmt.get())?.count || 0);
  if (total > 0 || !fs.existsSync(legacyJsonPath)) {
    return;
  }

  let parsed = [];
  try {
    const raw = fs.readFileSync(legacyJsonPath, "utf-8");
    parsed = JSON.parse(raw || "[]");
  } catch {
    parsed = [];
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return;
  }

  withDbRecovery(() => {
    db.exec("BEGIN");
    try {
      for (const item of parsed) {
        const job = item && typeof item === "object" ? item : {};
        const id = String(job.jobId || "");
        if (!id) continue;
        upsertStmt.run(rowFromJob({ ...job, jobId: id }));
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
};

initializeDatabase();
migrateLegacyJsonIfNeeded();

const saveJob = (job, createdAt) => {
  const row = rowFromJob(job, createdAt);
  if (!row.job_id) {
    throw new Error("jobId is required");
  }
  withDbRecovery(() => upsertStmt.run(row));
  return { ...job, jobId: row.job_id };
};

const getExistingCreatedAt = (jobId) => {
  const row = withDbRecovery(() => getByIdStmt.get(String(jobId)));
  return row?.created_at || nowIso();
};

export const createJob = (data) => {
  const created =
    data && typeof data === "object" ? saveJob({ ...data }) : saveJob({});
  emitJobUpdate("created", created);
  return created;
};

export const getAllJobs = () => {
  return withDbRecovery(() => getAllStmt.all())
    .map(parsePayload)
    .filter(Boolean);
};

export const getJobById = (jobId) => {
  const row = withDbRecovery(() => getByIdStmt.get(String(jobId)));
  return parsePayload(row);
};

export const updateJobStatus = (jobId, status) => {
  const existing = getJobById(jobId);
  if (!existing) {
    throw new Error(`Job with jobId ${jobId} not found`);
  }

  const updated = saveJob(
    {
      ...existing,
      status,
    },
    getExistingCreatedAt(jobId)
  );

  emitJobUpdate("status", updated);
  return updated;
};

export const updateJobResult = (jobId, result) => {
  const existing = getJobById(jobId);
  if (!existing) {
    throw new Error(`Job with jobId ${jobId} not found`);
  }

  const updated = saveJob(
    {
      ...existing,
      ...(result && typeof result === "object" ? result : {}),
      jobId: String(jobId),
    },
    getExistingCreatedAt(jobId)
  );

  emitJobUpdate("updated", updated);
  return updated;
};

export const updateSecondaryJobByPrimaryJobId = (jobId, result) => {
  const existing = getJobById(jobId);
  if (!existing) {
    return null;
  }

  const updated = saveJob(
    {
      ...existing,
      ...(result && typeof result === "object" ? result : {}),
      jobId: String(jobId),
    },
    getExistingCreatedAt(jobId)
  );

  emitJobUpdate("updated", updated);
  return updated;
};

export const updateSecondaryJob = (jobId, result) => {
  const row = withDbRecovery(() => getBySecondaryIdStmt.get(String(jobId)));
  const existing = parsePayload(row);
  if (!existing) {
    return null;
  }

  const updated = saveJob(
    {
      ...existing,
      ...(result && typeof result === "object" ? result : {}),
    },
    row?.created_at || nowIso()
  );

  emitJobUpdate("updated", updated);
  return updated;
};

export const deleteJob = (jobId) => {
  const existing = getJobById(jobId);
  if (!existing) {
    throw new Error(`Job with jobId ${jobId} not found`);
  }

  withDbRecovery(() => deleteByIdStmt.run(String(jobId)));
  emitJobUpdate("deleted", existing);
  return existing;
};

export const getJobsByGroupId = (groupId) => {
  return withDbRecovery(() => getByGroupStmt.all(String(groupId)))
    .map(parsePayload)
    .filter(Boolean);
};

export const resetJobs = () => {
  const info = withDbRecovery(() => resetStmt.run());
  return Number(info?.changes || 0);
};

export const removeSyntheticOffPlatformJobs = () => {
  const info = withDbRecovery(() => deleteSyntheticStmt.run());
  return Number(info?.changes || 0);
};
