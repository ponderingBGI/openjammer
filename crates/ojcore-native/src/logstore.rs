//! L3 — the native persistent log store (SQLite + FTS5).
//!
//! The on-device, never-to-a-server log history (plan §5.1). Decoded engine
//! events are appended to a SQLite table whose columns mirror the L2 `EventKind`
//! taxonomy and the UI's `LogEntry` shape, and a full-text (FTS5) index over the
//! message + kind makes "smart search" over a long history fast.
//!
//! This module is deliberately **decoupled from `ojproto`**: it takes a plain
//! [`LogRecord`] of already-rendered fields, so the store has no engine
//! dependency and is trivially testable. The caller (the control-side event
//! drain) maps a decoded `ojproto::Event` into a [`LogRecord`].
//!
//! Native-first: it is gated behind the `persist` feature and uses bundled
//! SQLite (FTS5 compiled in), so there is no system-sqlite dependency. The
//! browser OPFS/sqlite-wasm leg is intentionally not built until a real
//! large-history-search need emerges.

use rusqlite::{params, Connection};
use std::path::Path;

/// One log row to persist. Borrows its string fields so the hot drain path can
/// pass slices without allocating. `fields_json` is optional structured payload
/// (e.g. the `EventKind` variant's fields serialized to JSON).
#[derive(Debug, Clone)]
pub struct LogRecord<'a> {
    /// Microseconds since the Unix epoch (matches `ojproto::Event::ts_us`).
    pub ts_us: i64,
    /// Monotonic per-source sequence number.
    pub seq: i64,
    /// Severity variant name: `Trace|Debug|Info|Warn|Error`.
    pub severity: &'a str,
    /// Source variant name: `Engine|Wasm|Ui|Native`.
    pub source: &'a str,
    /// `EventKind` variant name: `Xrun|NodeFault|Lifecycle|…`.
    pub kind: &'a str,
    /// Human-readable, already-redaction-safe message.
    pub message: &'a str,
    /// Correlation id for click-to-correlate (0 if none).
    pub corr_id: i64,
    /// Optional JSON of the structured `EventKind` payload.
    pub fields_json: Option<&'a str>,
}

/// A row returned by [`LogStore::search`].
#[derive(Debug, Clone, PartialEq)]
pub struct LogHit {
    pub id: i64,
    pub ts_us: i64,
    pub severity: String,
    pub source: String,
    pub kind: String,
    pub message: String,
    pub corr_id: i64,
}

/// The persistent log store. Wraps one SQLite connection; not `Sync` — the
/// drain thread owns it and is the single writer.
pub struct LogStore {
    conn: Connection,
}

const SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_us    INTEGER NOT NULL,
  seq      INTEGER NOT NULL,
  severity TEXT    NOT NULL,
  source   TEXT    NOT NULL,
  kind     TEXT    NOT NULL,
  message  TEXT    NOT NULL,
  corr_id  INTEGER NOT NULL,
  fields   TEXT
);
CREATE INDEX IF NOT EXISTS events_ts_idx ON events(ts_us);
-- External-content FTS5 index over the searchable text; kept in sync by the
-- AFTER INSERT trigger below. If this CREATE fails, the linked SQLite lacks
-- FTS5 — a hard, gated error (see `fts5_available`).
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  message, kind, content='events', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS events_after_insert AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, message, kind) VALUES (new.id, new.message, new.kind);
END;";

impl LogStore {
    /// Open (creating if needed) a persistent store at `path`.
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        Self::from_conn(Connection::open(path)?)
    }

    /// Open an in-memory store (used by tests and ephemeral sessions).
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        Self::from_conn(Connection::open_in_memory()?)
    }

    fn from_conn(conn: Connection) -> rusqlite::Result<Self> {
        // Append-mostly local log: WAL lets readers run while the drain writes;
        // NORMAL sync is durable enough. Set via execute_batch (sqlite3_exec),
        // which tolerates `journal_mode` returning its new value — a plain
        // `execute`/`pragma_update` would error with "returned results". On an
        // in-memory db WAL is silently a no-op, which is fine for tests.
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    /// Append one event. Returns the new row id.
    pub fn insert(&self, r: &LogRecord<'_>) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO events (ts_us, seq, severity, source, kind, message, corr_id, fields)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                r.ts_us,
                r.seq,
                r.severity,
                r.source,
                r.kind,
                r.message,
                r.corr_id,
                r.fields_json,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Total rows persisted.
    pub fn count(&self) -> rusqlite::Result<i64> {
        self.conn
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
    }

    /// Full-text search over message + kind, most-recent first. `query` is an
    /// FTS5 MATCH expression (e.g. `"xrun"`, `"node*"`, `"kind:NodeFault"`).
    pub fn search(&self, query: &str, limit: i64) -> rusqlite::Result<Vec<LogHit>> {
        // NB: the FTS table is referenced unaliased — `events_fts MATCH ?` needs
        // the table's real name in scope; aliasing it would shadow that name.
        let mut stmt = self.conn.prepare(
            "SELECT e.id, e.ts_us, e.severity, e.source, e.kind, e.message, e.corr_id
               FROM events_fts JOIN events e ON e.id = events_fts.rowid
              WHERE events_fts MATCH ?1
              ORDER BY e.id DESC
              LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![query, limit], |row| {
            Ok(LogHit {
                id: row.get(0)?,
                ts_us: row.get(1)?,
                severity: row.get(2)?,
                source: row.get(3)?,
                kind: row.get(4)?,
                message: row.get(5)?,
                corr_id: row.get(6)?,
            })
        })?;
        rows.collect()
    }

    /// Delete all but the most recent `keep` rows (history cap). Returns the
    /// number deleted. The FTS index is kept consistent by deleting from the
    /// external-content table explicitly first.
    pub fn prune_to(&self, keep: i64) -> rusqlite::Result<usize> {
        let cutoff: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET ?1",
                params![keep],
                |row| row.get(0),
            )
            .ok();
        let Some(cutoff) = cutoff else { return Ok(0) };
        self.conn.execute(
            "INSERT INTO events_fts(events_fts, rowid, message, kind)
             SELECT 'delete', id, message, kind FROM events WHERE id <= ?1",
            params![cutoff],
        )?;
        let n = self
            .conn
            .execute("DELETE FROM events WHERE id <= ?1", params![cutoff])?;
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bundled SQLite MUST have FTS5 compiled in — an FTS5-off store is a
    /// silent runtime failure (plan §5.1 must-fix), so this is a gated smoke.
    #[test]
    fn fts5_available() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            "CREATE VIRTUAL TABLE t USING fts5(x);
             INSERT INTO t(x) VALUES ('hello world');",
        )
        .expect("FTS5 must be available in the linked SQLite");
        let n: i64 = conn
            .query_row("SELECT count(*) FROM t WHERE t MATCH 'hello'", [], |r| {
                r.get(0)
            })
            .expect("MATCH query");
        assert_eq!(n, 1, "FTS5 MATCH should find the inserted row");
    }

    fn rec<'a>(seq: i64, kind: &'a str, message: &'a str) -> LogRecord<'a> {
        LogRecord {
            ts_us: seq * 1_000,
            seq,
            severity: "Info",
            source: "Engine",
            kind,
            message,
            corr_id: 0,
            fields_json: None,
        }
    }

    #[test]
    fn insert_and_full_text_search_roundtrip() {
        let store = LogStore::open_in_memory().expect("store");
        store
            .insert(&rec(1, "Xrun", "xrun: 3 frames dropped"))
            .unwrap();
        store
            .insert(&rec(2, "NodeFault", "node 4 produced a non-finite sample"))
            .unwrap();
        store
            .insert(&rec(3, "Lifecycle", "engine started"))
            .unwrap();
        assert_eq!(store.count().unwrap(), 3);

        // term in the message column
        let hits = store.search("xrun", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "Xrun");

        // term in the kind column (FTS indexes both columns)
        let faults = store.search("NodeFault", 10).unwrap();
        assert_eq!(faults.len(), 1);
        assert_eq!(faults[0].message, "node 4 produced a non-finite sample");

        // a term present in no row
        assert!(store.search("nonexistentterm", 10).unwrap().is_empty());
    }

    #[test]
    fn search_returns_most_recent_first_and_respects_limit() {
        let store = LogStore::open_in_memory().expect("store");
        for i in 1..=5 {
            store.insert(&rec(i, "Midi", "note on event")).unwrap();
        }
        let hits = store.search("note", 3).unwrap();
        assert_eq!(hits.len(), 3, "limit respected");
        assert!(
            hits[0].id > hits[1].id && hits[1].id > hits[2].id,
            "most-recent-first ordering"
        );
    }

    #[test]
    fn prune_caps_history_and_keeps_fts_consistent() {
        let store = LogStore::open_in_memory().expect("store");
        for i in 1..=10 {
            store.insert(&rec(i, "Midi", "note on event")).unwrap();
        }
        let deleted = store.prune_to(4).unwrap();
        assert_eq!(deleted, 6);
        assert_eq!(store.count().unwrap(), 4);
        // FTS must reflect the prune: only the surviving 4 rows are searchable.
        assert_eq!(store.search("note", 100).unwrap().len(), 4);
    }
}
