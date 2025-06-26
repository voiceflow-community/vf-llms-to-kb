import Database from 'better-sqlite3';
import { UploadTask } from './types';

const db = new Database('vfllms.db');

db.exec(`
CREATE TABLE IF NOT EXISTS doc_hashes (
  url TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  lastUploaded INTEGER,
  documentID TEXT
);
CREATE TABLE IF NOT EXISTS upload_tasks (
  id TEXT PRIMARY KEY,
  status TEXT,
  progress INTEGER,
  message TEXT,
  startedAt INTEGER,
  finishedAt INTEGER
);
`);

// Migration: add documentID column if it doesn't exist
const pragma = db.prepare(`PRAGMA table_info(doc_hashes)`).all();
if (!pragma.some((col: any) => col.name === 'documentID')) {
  db.exec(`ALTER TABLE doc_hashes ADD COLUMN documentID TEXT`);
}

export function getDocHash(url: string): string | undefined {
  const row = db.prepare('SELECT hash FROM doc_hashes WHERE url = ?').get(url) as { hash?: string } | undefined;
  return row?.hash;
}

export function setDocHash(url: string, hash: string, documentID?: string): void {
  db.prepare('INSERT OR REPLACE INTO doc_hashes (url, hash, lastUploaded, documentID) VALUES (?, ?, ?, ?)')
    .run(url, hash, Date.now(), documentID);
}

export function getAllDocHashes(): { url: string; hash: string; lastUploaded: number; documentID?: string }[] {
  return db.prepare('SELECT * FROM doc_hashes').all() as { url: string; hash: string; lastUploaded: number; documentID?: string }[];
}

export function createTask(task: UploadTask): void {
  db.prepare('INSERT INTO upload_tasks (id, status, progress, message, startedAt, finishedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(task.id, task.status, task.progress, task.message, task.startedAt, task.finishedAt);
}

export function updateTaskStatus(id: string, status: string, progress: number, message?: string, finishedAt?: number): void {
  db.prepare('UPDATE upload_tasks SET status = ?, progress = ?, message = ?, finishedAt = ? WHERE id = ?')
    .run(status, progress, message, finishedAt, id);
}

export function getTask(id: string): UploadTask | undefined {
  return db.prepare('SELECT * FROM upload_tasks WHERE id = ?').get(id) as UploadTask | undefined;
}

export function deleteDocHash(url: string): void {
  db.prepare('DELETE FROM doc_hashes WHERE url = ?').run(url);
}
