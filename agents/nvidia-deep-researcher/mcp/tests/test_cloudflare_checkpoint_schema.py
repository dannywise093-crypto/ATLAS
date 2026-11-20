from __future__ import annotations

import sqlite3
from pathlib import Path


SCHEMA = Path(__file__).parents[2] / "deploy" / "checkpoint_schema.sql"


def connect():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(SCHEMA.read_text(encoding="utf-8"))
    return db


def test_schema_creates_tenant_scoped_checkpoint_and_write_tables():
    db = connect()
    names = {
        row[0]
        for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    assert {
        "research_checkpoint_thread_tombstones",
        "research_checkpoint_threads",
        "research_checkpoints",
        "research_checkpoint_writes",
        "research_checkpoint_r2_gc",
    } <= names


def test_checkpoint_and_pending_write_rows_require_valid_parent_records():
    db = connect()
    db.execute(
        """INSERT INTO research_checkpoint_threads
        (tenant_id,thread_id,checkpoint_ns,created_at,updated_at)
        VALUES('tenant-a','thread-1','',1,1)"""
    )
    db.execute(
        """INSERT INTO research_checkpoints
        (tenant_id,thread_id,checkpoint_ns,checkpoint_id,parent_checkpoint_id,
         checkpoint_type,checkpoint_r2_key,checkpoint_sha256,checkpoint_bytes,
         metadata_type,metadata_r2_key,metadata_sha256,metadata_bytes,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("tenant-a","thread-1","","cp-1",None,"msgpack","tenant-a/thread-1/cp-1",
         "a"*64,1024,"msgpack","tenant-a/thread-1/cp-1-meta","b"*64,64,2),
    )
    db.execute(
        """INSERT INTO research_checkpoint_writes
        (tenant_id,thread_id,checkpoint_ns,checkpoint_id,task_id,task_path,
         write_index,channel,value_type,value_r2_key,value_sha256,value_bytes,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("tenant-a","thread-1","","cp-1","task-1","node",0,"result",
         "msgpack","tenant-a/thread-1/cp-1-write-0","c"*64,16,3),
    )
    assert db.execute("SELECT COUNT(*) FROM research_checkpoint_writes").fetchone()[0] == 1


def test_checkpoint_rows_are_isolated_by_tenant_and_namespace():
    db = connect()
    db.execute(
        """INSERT INTO research_checkpoint_threads
        (tenant_id,thread_id,checkpoint_ns,created_at,updated_at)
        VALUES('tenant-a','shared-thread','',1,1),
              ('tenant-b','shared-thread','',1,1),
              ('tenant-a','shared-thread','subgraph',1,1)"""
    )
    rows = db.execute(
        "SELECT tenant_id,checkpoint_ns FROM research_checkpoint_threads WHERE thread_id=? ORDER BY tenant_id,checkpoint_ns",
        ("shared-thread",),
    ).fetchall()
    assert rows == [("tenant-a", ""), ("tenant-a", "subgraph"), ("tenant-b", "")]


def test_schema_rejects_bad_hash_lengths_and_negative_payload_sizes():
    db = connect()
    db.execute(
        """INSERT INTO research_checkpoint_threads
        (tenant_id,thread_id,checkpoint_ns,created_at,updated_at)
        VALUES('tenant-a','thread-1','',1,1)"""
    )
    try:
        db.execute(
            """INSERT INTO research_checkpoints
            (tenant_id,thread_id,checkpoint_ns,checkpoint_id,checkpoint_type,
             checkpoint_r2_key,checkpoint_sha256,checkpoint_bytes,metadata_type,
             metadata_r2_key,metadata_sha256,metadata_bytes,created_at)
            VALUES('tenant-a','thread-1','','cp-1','msgpack','key','bad',-1,
                   'msgpack','meta-key',?,1,2)""",
            ("d"*64,),
        )
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("invalid hash and payload size must be rejected")


def test_schema_is_idempotent():
    db = sqlite3.connect(":memory:")
    db.executescript(SCHEMA.read_text(encoding="utf-8"))
    db.executescript(SCHEMA.read_text(encoding="utf-8"))


def test_deleted_thread_tombstones_are_tenant_scoped_and_persist_without_thread_rows():
    db = connect()
    db.execute(
        "INSERT INTO research_checkpoint_thread_tombstones (tenant_id,thread_id,deleted_at) VALUES(?,?,?)",
        ("tenant-a", "thread-1", 100),
    )
    assert db.execute(
        "SELECT deleted_at FROM research_checkpoint_thread_tombstones WHERE tenant_id=? AND thread_id=?",
        ("tenant-a", "thread-1"),
    ).fetchone() == (100,)
    assert db.execute(
        "SELECT COUNT(*) FROM research_checkpoint_threads WHERE tenant_id=? AND thread_id=?",
        ("tenant-a", "thread-1"),
    ).fetchone()[0] == 0
