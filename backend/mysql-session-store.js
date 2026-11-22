"use strict";

const session = require("express-session");

const TABLE_NAME = "pos_sessions";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

class MySQLSessionStore extends session.Store {
    constructor(pool) {
        super();
        this.pool = pool;
        this.tableReady = null;
        this.cleanupTimer = null;
    }

    query(sql, parameters = []) {
        return new Promise((resolve, reject) => {
            this.pool.query(sql, parameters, (error, result) => {
                if (error) return reject(error);
                resolve(result);
            });
        });
    }

    ensureTable() {
        if (!this.tableReady) {
            this.tableReady = this.query(`
                CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
                    sid VARCHAR(128) NOT NULL PRIMARY KEY,
                    expires BIGINT UNSIGNED NOT NULL,
                    session_data MEDIUMTEXT NOT NULL,
                    INDEX idx_pos_sessions_expires (expires)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `).then(() => {
                this.startCleanup();
            }).catch(error => {
                this.tableReady = null;
                throw error;
            });
        }
        return this.tableReady;
    }

    startCleanup() {
        if (this.cleanupTimer) return;
        this.cleanupTimer = setInterval(() => {
            this.query(`DELETE FROM ${TABLE_NAME} WHERE expires <= ?`, [Date.now()])
                .catch(error => console.error("Session cleanup failed:", error.message));
        }, 60 * 60 * 1000);
        this.cleanupTimer.unref();
    }

    expirationTime(sessionData) {
        const cookie = sessionData && sessionData.cookie ? sessionData.cookie : {};
        if (cookie.expires) {
            const expires = new Date(cookie.expires).getTime();
            if (Number.isFinite(expires)) return expires;
        }
        if (Number.isFinite(cookie.maxAge) && cookie.maxAge > 0) {
            return Date.now() + cookie.maxAge;
        }
        return Date.now() + DEFAULT_TTL_MS;
    }

    get(sid, callback) {
        this.ensureTable()
            .then(() => this.query(
                `SELECT session_data FROM ${TABLE_NAME} WHERE sid = ? AND expires > ? LIMIT 1`,
                [sid, Date.now()]
            ))
            .then(rows => {
                if (!rows.length) return callback(null, null);
                try {
                    return callback(null, JSON.parse(rows[0].session_data));
                } catch (error) {
                    this.destroy(sid, () => {});
                    return callback(error);
                }
            })
            .catch(callback);
    }

    set(sid, sessionData, callback) {
        const serialized = JSON.stringify(sessionData);
        const expires = this.expirationTime(sessionData);
        this.ensureTable()
            .then(() => this.query(
                `INSERT INTO ${TABLE_NAME} (sid, expires, session_data)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE expires = VALUES(expires), session_data = VALUES(session_data)`,
                [sid, expires, serialized]
            ))
            .then(() => callback && callback(null))
            .catch(error => callback && callback(error));
    }

    touch(sid, sessionData, callback) {
        const expires = this.expirationTime(sessionData);
        this.ensureTable()
            .then(() => this.query(
                `UPDATE ${TABLE_NAME} SET expires = ? WHERE sid = ?`,
                [expires, sid]
            ))
            .then(() => callback && callback(null))
            .catch(error => callback && callback(error));
    }

    destroy(sid, callback) {
        this.ensureTable()
            .then(() => this.query(`DELETE FROM ${TABLE_NAME} WHERE sid = ?`, [sid]))
            .then(() => callback && callback(null))
            .catch(error => callback && callback(error));
    }

    clear(callback) {
        this.ensureTable()
            .then(() => this.query(`DELETE FROM ${TABLE_NAME}`))
            .then(() => callback && callback(null))
            .catch(error => callback && callback(error));
    }
}

module.exports = MySQLSessionStore;
