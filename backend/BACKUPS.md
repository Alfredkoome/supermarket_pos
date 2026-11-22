# Automatic database backups

The Node.js backend is the only component that schedules or creates backups. Cashier browsers call no scheduler and do not connect to MySQL. Backups are plain SQL files in the existing directory configured by `BACKUP_DIR`; the backend does not create that directory. Paths with spaces are supported. `BACKUP_SCHEDULE_TIME` defaults to `23:00`, and `BACKUP_TIMEZONE` defaults to `Africa/Nairobi`.

On Windows, the configured existing folder is secured with `icacls` for the backend account, Local System, and local Administrators. The account running Node must be able to access the directory and set its ACL. A backup is not reported as successful if its output cannot be written or validated.

The backend uses MySQL's `mysqldump` utility with a consistent InnoDB snapshot and includes tables, views, routines, triggers, events, indexes, keys, constraints, and records. It writes to a temporary file, checks the process exit status, checks the dump header, table definitions, completion marker and file size, then publishes the timestamped `.sql` file with an atomic same-volume hard link that cannot replace an existing file. The client credential file is temporary and removed after the attempt. Backup history (including failed attempts and their error messages) is stored in `backup-history.json` in the protected folder. Successful backup files older than the newest 30 app-generated files are removed after a successful backup. Unrelated files are not part of retention cleanup.

If the backend starts after a scheduled backup was missed, it runs a catch-up backup. If MySQL or the backup utility is unavailable, the failure is recorded when the protected folder is writable and the backend retries every 15 minutes. A missed historical day's exact data cannot be recreated; catch-up captures the database as it exists when service becomes available again. Automatic restore is not implemented. `POST /backups/run` provides an administrator-only manual backup; `GET /backups/history` is administrator-only.

## Separate-database recovery test

To verify recovery without touching the live database, first copy a `.sql` file to a controlled test machine or protected working folder. Create an empty test schema with a distinct name, for example `supermarket_pos_restore_test`, and restore the file using a MySQL account that can write only to that test schema. Do not use `supermarket_pos` as the target. Then compare table, index, foreign-key and constraint metadata and representative row counts with the dump. Delete the test schema only after confirming that it is the isolated test schema. No restore is run by the POS backup scheduler or this implementation.

The dump process's exit status, output size, header, table-definition marker and completion marker are checked. This is a file-integrity check; only restoring into an isolated test schema can verify end-to-end restorability. The live database must never be used for that test.
