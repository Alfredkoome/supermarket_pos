"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");
const { pipeline } = require("stream/promises");

const execFileAsync = promisify(execFile);
const DATABASE_NAME = "supermarket_pos";
const BACKUP_DIRECTORY = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : null;
const HISTORY_PATH = BACKUP_DIRECTORY ? path.join(BACKUP_DIRECTORY, "backup-history.json") : null;
const LOCK_PATH = BACKUP_DIRECTORY ? path.join(BACKUP_DIRECTORY, ".backup-process.lock") : null;
const BACKUP_TIMEZONE = process.env.BACKUP_TIMEZONE || "Africa/Nairobi";
const datePartsFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: BACKUP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
});
const RETENTION_COUNT = 30;
const HISTORY_LIMIT = 1000;
const RETRY_MINUTES = 15;
const BACKUP_FILE_PATTERN = /^pos-auto-supermarket_pos_\d{8}_\d{6}_\d{3}(?:_\d+)?\.sql$/;

let directorySecurityPromise;
let activeBackupPromise;
let schedulerStarted = false;
let nextRetryAt = 0;

function localDateKey(date = new Date()) {
    const parts = dateParts(date);
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function pad(value) {
    return String(value).padStart(2, "0");
}

function dateParts(date) {
    const values = Object.fromEntries(
        datePartsFormatter.formatToParts(date).map(part => [part.type, part.value])
    );
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        minute: Number(values.minute),
        second: Number(values.second)
    };
}

function parseScheduleTime(value = process.env.BACKUP_SCHEDULE_TIME || "23:00") {
    const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(value.trim());
    if (!match) {
        throw new Error("BACKUP_SCHEDULE_TIME must use 24-hour HH:mm format.");
    }
    return { hour: Number(match[1]), minute: Number(match[2]), text: value.trim() };
}

function scheduledDate(date, schedule) {
    const parts = dateParts(date);
    const wantedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, schedule.hour, schedule.minute, 0);
    let result = wantedUtc;

    // Convert the requested wall-clock time in BACKUP_TIMEZONE to a UTC instant.
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const displayed = dateParts(new Date(result));
        const displayedAsUtc = Date.UTC(
            displayed.year,
            displayed.month - 1,
            displayed.day,
            displayed.hour,
            displayed.minute,
            displayed.second
        );
        const correction = wantedUtc - displayedAsUtc;
        if (correction === 0) break;
        result += correction;
    }
    return new Date(result);
}

function oneDayBefore(date) {
    const parts = dateParts(date);
    const result = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1));
    return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

function safeError(error) {
    return String(error && error.message ? error.message : error)
        .replace(/[\r\n\0]+/g, " ")
        .slice(0, 1500);
}

function backupDirectory() {
    if (!BACKUP_DIRECTORY) {
        throw new Error("Set BACKUP_DIR to the full path of an existing protected folder; automatic folder creation is disabled.");
    }
    return BACKUP_DIRECTORY;
}

async function ensureSecureBackupDirectory() {
    if (!directorySecurityPromise) {
        directorySecurityPromise = (async () => {
            const stat = await fsp.stat(backupDirectory());
            if (!stat.isDirectory()) throw new Error("BACKUP_DIR must point to an existing directory.");

            if (process.platform === "win32") {
                const { stdout } = await execFileAsync("whoami.exe", [], {
                    windowsHide: true,
                    timeout: 10000
                });
                const account = stdout.trim();
                if (!account) throw new Error("Could not identify the backend Windows account.");

                await execFileAsync("icacls.exe", [
                    backupDirectory(),
                    "/inheritance:r",
                    "/grant:r",
                    `${account}:(OI)(CI)F`,
                    "*S-1-5-18:(OI)(CI)F",
                    "*S-1-5-32-544:(OI)(CI)F",
                    "/T"
                ], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
            } else {
                await fsp.chmod(backupDirectory(), 0o700);
            }
        })().catch(error => {
            directorySecurityPromise = null;
            throw error;
        });
    }
    return directorySecurityPromise;
}

async function readHistory() {
    try {
        const content = await fsp.readFile(HISTORY_PATH, "utf8");
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) throw new Error("Backup history file has an invalid format.");
        return parsed;
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }
}

async function writeHistory(history) {
    const temporaryPath = `${HISTORY_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const handle = await fsp.open(temporaryPath, "wx", 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(history.slice(-HISTORY_LIMIT), null, 2)}\n`, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    await fsp.rename(temporaryPath, HISTORY_PATH);
}

async function appendHistory(entry) {
    await ensureSecureBackupDirectory();
    const history = await readHistory();
    history.push(entry);
    await writeHistory(history);
}

function aliveProcess(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
}

async function acquireProcessLock() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const handle = await fsp.open(LOCK_PATH, "wx", 0o600);
            await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
            await handle.sync();
            return handle;
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
            let owner;
            try {
                owner = JSON.parse(await fsp.readFile(LOCK_PATH, "utf8"));
            } catch (_) {
                owner = null;
            }
            if (owner && aliveProcess(Number(owner.pid))) return null;
            try { await fsp.unlink(LOCK_PATH); } catch (unlinkError) {
                if (unlinkError.code !== "ENOENT") return null;
            }
        }
    }
    return null;
}

async function releaseProcessLock(handle) {
    if (handle) await handle.close().catch(() => {});
    await fsp.unlink(LOCK_PATH).catch(error => {
        if (error.code !== "ENOENT") console.error("Could not remove backup lock:", error.message);
    });
}

async function cleanStaleTemporaryFiles() {
    const entries = await fsp.readdir(backupDirectory(), { withFileTypes: true });
    const staleBefore = Date.now() - 60 * 60 * 1000;
    const ownedTemporaryName = /^(?:\.mysql-backup-\d+-[0-9a-f-]+\.cnf|\..+\.sql\.[0-9a-f-]+\.partial|backup-history\.json\..+\.tmp)$/i;

    for (const entry of entries) {
        if (!entry.isFile() || !ownedTemporaryName.test(entry.name)) continue;
        const fullPath = path.join(backupDirectory(), entry.name);
        const stat = await fsp.stat(fullPath);
        if (stat.mtimeMs < staleBefore) await fsp.unlink(fullPath);
    }
}

function optionFileValue(value) {
    return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
}

function mysqlDumpPath() {
    if (process.env.MYSQLDUMP_PATH) return process.env.MYSQLDUMP_PATH;
    if (process.platform === "win32") {
        const standardPath = "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe";
        if (fs.existsSync(standardPath)) return standardPath;
    }
    return process.platform === "win32" ? "mysqldump.exe" : "mysqldump";
}

function createClientOptionsFile() {
    const database = process.env.DB_DATABASE || DATABASE_NAME;
    if (database !== DATABASE_NAME) {
        throw new Error(`Automatic backups are configured only for ${DATABASE_NAME}; DB_DATABASE is ${database}.`);
    }
    if (!process.env.DB_USER || process.env.DB_PASSWORD === undefined) {
        throw new Error("DB_USER and DB_PASSWORD must be configured for automatic backups.");
    }

    return [
        "[client]",
        `host="${optionFileValue(process.env.DB_HOST || "localhost")}"`,
        `port=${Number(process.env.DB_PORT) || 3306}`,
        `user="${optionFileValue(process.env.DB_USER)}"`,
        `password="${optionFileValue(process.env.DB_PASSWORD)}"`,
        "protocol=TCP",
        "default-character-set=utf8mb4",
        ""
    ].join("\n");
}

function spawnDump(optionsFile, temporaryPath) {
    const args = [
        `--defaults-extra-file=${optionsFile}`,
        "--single-transaction",
        "--skip-lock-tables",
        "--routines",
        "--triggers",
        "--events",
        "--hex-blob",
        "--no-tablespaces",
        "--column-statistics=0",
        "--set-gtid-purged=OFF",
        DATABASE_NAME
    ];
    const child = spawn(mysqlDumpPath(), args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
        stderr = `${stderr}${chunk}`.slice(-16000);
    });

    const outputPromise = pipeline(
        child.stdout,
        fs.createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 })
    );
    const exitPromise = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
    });

    return Promise.all([outputPromise, exitPromise]).then(([, exit]) => {
        if (exit.code !== 0) {
            const detail = stderr.trim() || `mysqldump exited with code ${exit.code}${exit.signal ? ` (${exit.signal})` : ""}.`;
            throw new Error(detail);
        }
        return stderr.trim();
    }).catch(async error => {
        if (child.exitCode === null) {
            child.kill();
            await exitPromise.catch(() => {});
        }
        throw error;
    });
}

async function validateDump(filePath) {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size < 256) throw new Error("mysqldump produced an empty or unexpectedly small file.");

    const handle = await fsp.open(filePath, "r");
    try {
        const headLength = Math.min(8192, stat.size);
        const tailLength = Math.min(8192, stat.size);
        const head = Buffer.alloc(headLength);
        const tail = Buffer.alloc(tailLength);
        await handle.read(head, 0, headLength, 0);
        await handle.read(tail, 0, tailLength, stat.size - tailLength);
        const first = head.toString("utf8");
        const last = tail.toString("utf8");
        if (!/MySQL dump/i.test(first)) throw new Error("Backup validation failed: missing MySQL dump header.");
        if (!/Dump completed on/i.test(last)) throw new Error("Backup validation failed: dump completion marker is missing.");
    } finally {
        await handle.close();
    }

    let foundTableDefinition = false;
    let overlap = "";
    for await (const chunk of fs.createReadStream(filePath)) {
        const contents = overlap + chunk.toString("utf8");
        if (/CREATE TABLE/i.test(contents)) foundTableDefinition = true;
        overlap = contents.slice(-32);
        if (foundTableDefinition) break;
    }
    if (!foundTableDefinition) throw new Error("Backup validation failed: no table definitions were found.");
}

function fileTimestamp(date = new Date()) {
    const parts = dateParts(date);
    return `${parts.year}${pad(parts.month)}${pad(parts.day)}_${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}_${String(date.getUTCMilliseconds()).padStart(3, "0")}`;
}

async function uniqueBackupPath(date) {
    const stem = `pos-auto-supermarket_pos_${fileTimestamp(date)}`;
    for (let suffix = 0; suffix < 1000; suffix += 1) {
        const name = `${stem}${suffix ? `_${suffix}` : ""}.sql`;
        const fullPath = path.join(backupDirectory(), name);
        try {
            await fsp.access(fullPath);
        } catch (error) {
            if (error.code === "ENOENT") return { name, fullPath };
            throw error;
        }
    }
    throw new Error("Could not allocate a unique timestamped backup filename.");
}

async function applyRetention() {
    const entries = await fsp.readdir(backupDirectory(), { withFileTypes: true });
    const backups = entries
        .filter(entry => entry.isFile() && BACKUP_FILE_PATTERN.test(entry.name))
        .map(entry => entry.name)
        .sort()
        .reverse();

    const removed = [];
    for (const filename of backups.slice(RETENTION_COUNT)) {
        await fsp.unlink(path.join(backupDirectory(), filename));
        removed.push(filename);
    }
    return removed;
}

async function performBackup({ reason = "manual", initiatedBy = null, scheduledFor = null } = {}) {
    const createdAt = new Date();
    let lockHandle = null;
    let temporaryPath = null;
    let optionsPath = null;
    let finalPath = null;
    let filename = null;
    let finalCreated = false;

    try {
        await ensureSecureBackupDirectory();
        lockHandle = await acquireProcessLock();
        if (!lockHandle) {
            return { status: "Skipped", filename: null, createdAt: createdAt.toISOString(), errorMessage: "Another backend process is currently running a backup." };
        }

        await cleanStaleTemporaryFiles();
        const history = await readHistory();
        const today = localDateKey(createdAt);
        if ((reason === "scheduled" || reason === "catch-up") && history.some(item =>
            item.status === "Success" &&
            (item.reason === "scheduled" || item.reason === "catch-up") &&
            localDateKey(new Date(item.createdAt)) === today
        )) {
            return { status: "Skipped", filename: null, createdAt: createdAt.toISOString(), errorMessage: null };
        }

        optionsPath = path.join(backupDirectory(), `.mysql-backup-${process.pid}-${crypto.randomUUID()}.cnf`);
        await fsp.writeFile(optionsPath, createClientOptionsFile(), { flag: "wx", mode: 0o600 });
        const { fullPath, name } = await uniqueBackupPath(createdAt);
        filename = name;
        finalPath = fullPath;
        temporaryPath = path.join(backupDirectory(), `.${name}.${crypto.randomUUID()}.partial`);

        const warning = await spawnDump(optionsPath, temporaryPath);
        await validateDump(temporaryPath);
        const fileHandle = await fsp.open(temporaryPath, "r+");
        try { await fileHandle.sync(); } finally { await fileHandle.close(); }

        // NTFS hard-link creation is atomic and fails if the timestamped target already exists.
        await fsp.link(temporaryPath, finalPath);
        finalCreated = true;
        await fsp.unlink(temporaryPath);
        temporaryPath = null;

        let retentionError = null;
        try {
            await applyRetention();
        } catch (error) {
            retentionError = `Retention cleanup failed: ${safeError(error)}`;
        }

        const entry = {
            createdAt: createdAt.toISOString(),
            backupDate: today,
            scheduledFor,
            filename,
            status: "Success",
            errorMessage: retentionError || (warning || null),
            reason,
            initiatedBy
        };
        await appendHistory(entry);
        return entry;
    } catch (error) {
        const entry = {
            createdAt: createdAt.toISOString(),
            backupDate: localDateKey(createdAt),
            scheduledFor,
            filename: finalCreated ? filename : null,
            status: "Failed",
            errorMessage: safeError(error),
            reason,
            initiatedBy
        };
        try {
            await appendHistory(entry);
        } catch (historyError) {
            console.error("Could not record database backup failure:", safeError(historyError));
        }
        return entry;
    } finally {
        if (temporaryPath) await fsp.unlink(temporaryPath).catch(() => {});
        if (optionsPath) await fsp.unlink(optionsPath).catch(() => {});
        if (lockHandle) await releaseProcessLock(lockHandle);
    }
}

function runBackup(options = {}) {
    if (activeBackupPromise) return activeBackupPromise;
    activeBackupPromise = performBackup(options).finally(() => {
        activeBackupPromise = null;
    });
    return activeBackupPromise;
}

async function getHistory() {
    await ensureSecureBackupDirectory();
    return readHistory();
}

async function checkAndRunScheduledBackup() {
    if (Date.now() < nextRetryAt) return;
    const schedule = parseScheduleTime();
    const now = new Date();
    const today = localDateKey(now);
    const history = await getHistory();
    const successes = history
        .filter(item => item.status === "Success" && item.createdAt && (item.reason === "scheduled" || item.reason === "catch-up"))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const lastSuccessDate = successes.length ? localDateKey(new Date(successes[0].createdAt)) : null;

    if (successes.some(item => localDateKey(new Date(item.createdAt)) === today)) return;
    const missedPreviousDay = lastSuccessDate && lastSuccessDate < oneDayBefore(now);
    const scheduledAt = scheduledDate(now, schedule);
    if (!missedPreviousDay && now < scheduledAt) return;

    const recentFailure = history
        .filter(item => item.status === "Failed")
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (recentFailure && Date.now() - Date.parse(recentFailure.createdAt) < RETRY_MINUTES * 60 * 1000) return;

    const scheduledFor = scheduledAt.toISOString();
    const entry = await runBackup({ reason: missedPreviousDay ? "catch-up" : "scheduled", scheduledFor });
    if (entry.status === "Failed") {
        nextRetryAt = Date.now() + RETRY_MINUTES * 60 * 1000;
        console.error("Automatic database backup failed:", entry.errorMessage);
    } else if (entry.status === "Success") {
        nextRetryAt = 0;
        console.log(`Automatic database backup completed: ${entry.filename}`);
    }
}

function startBackupScheduler() {
    if (schedulerStarted) return;
    schedulerStarted = true;

    const tick = async () => {
        try {
            await checkAndRunScheduledBackup();
        } catch (error) {
            nextRetryAt = Date.now() + RETRY_MINUTES * 60 * 1000;
            console.error("Automatic backup scheduler error:", safeError(error));
        } finally {
            const delay = 60000 - (Date.now() % 60000);
            setTimeout(tick, delay).unref();
        }
    };

    void tick();
}

module.exports = {
    getHistory,
    parseScheduleTime,
    runBackup,
    startBackupScheduler,
    getScheduleTimezone: () => BACKUP_TIMEZONE
};
