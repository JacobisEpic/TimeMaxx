import * as SQLite from 'expo-sqlite';

import type { Block, Lane } from '@/src/types/blocks';

const DB_NAME = 'plan-vs-actual.db';
const SCHEMA_VERSION = '1';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initPromise: Promise<void> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  return dbPromise;
}

function parseLane(lane: string): Lane | null {
  return lane === 'planned' || lane === 'actual' ? lane : null;
}

function parseTags(tagsJson: string): string[] {
  try {
    const parsed = JSON.parse(tagsJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    return [];
  }

  return [];
}

function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type BlockRow = {
  id: string;
  lane: string;
  startMin: number;
  endMin: number;
  title: string;
  tagsJson: string;
};

function mapRowToBlock(row: BlockRow): Block | null {
  const lane = parseLane(row.lane);

  if (!lane) {
    return null;
  }

  return {
    id: row.id,
    lane,
    startMin: row.startMin,
    endMin: row.endMin,
    title: row.title,
    tags: parseTags(row.tagsJson),
  };
}

export async function initDb(): Promise<void> {
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    const db = await getDb();

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        dayKey TEXT NOT NULL,
        lane TEXT NOT NULL,
        startMin INTEGER NOT NULL,
        endMin INTEGER NOT NULL,
        title TEXT NOT NULL,
        tagsJson TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_blocks_day_lane_start
        ON blocks(dayKey, lane, startMin);

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    await db.runAsync(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?);',
      'schema_version',
      SCHEMA_VERSION
    );
  })();

  await initPromise;
}

export async function getBlocksForDay(dayKey: string): Promise<Block[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.getAllAsync<BlockRow>(
    `SELECT id, lane, startMin, endMin, title, tagsJson
     FROM blocks
     WHERE dayKey = ?
     ORDER BY lane ASC, startMin ASC, id ASC;`,
    dayKey
  );

  return rows
    .map((row) => mapRowToBlock(row))
    .filter((block): block is Block => block !== null);
}

export async function insertBlock(
  input: Omit<Block, 'id'> & { id?: string },
  dayKey: string
): Promise<Block> {
  await initDb();
  const db = await getDb();
  const id = input.id ?? generateUuidV4();
  const now = Date.now();

  await db.runAsync(
    `INSERT INTO blocks (id, dayKey, lane, startMin, endMin, title, tagsJson, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    id,
    dayKey,
    input.lane,
    input.startMin,
    input.endMin,
    input.title,
    JSON.stringify(input.tags),
    now
  );

  return {
    id,
    lane: input.lane,
    startMin: input.startMin,
    endMin: input.endMin,
    title: input.title,
    tags: input.tags,
  };
}

export async function updateBlock(block: Block, dayKey: string): Promise<void> {
  await initDb();
  const db = await getDb();
  const now = Date.now();

  await db.runAsync(
    `UPDATE blocks
      SET lane = ?, startMin = ?, endMin = ?, title = ?, tagsJson = ?, updatedAt = ?
      WHERE id = ? AND dayKey = ?;`,
    block.lane,
    block.startMin,
    block.endMin,
    block.title,
    JSON.stringify(block.tags),
    now,
    block.id,
    dayKey
  );
}

export async function deleteBlock(id: string): Promise<void> {
  await initDb();
  const db = await getDb();
  await db.runAsync('DELETE FROM blocks WHERE id = ?;', id);
}

export async function clearAllBlocks(): Promise<void> {
  await initDb();
  const db = await getDb();
  await db.runAsync('DELETE FROM blocks;');
}

type MetaRow = {
  value: string;
};

export async function getMetaValue(key: string): Promise<string | null> {
  await initDb();
  const db = await getDb();
  const rows = await db.getAllAsync<MetaRow>(
    'SELECT value FROM meta WHERE key = ? LIMIT 1;',
    key
  );
  return rows[0]?.value ?? null;
}

export async function setMetaValue(key: string, value: string): Promise<void> {
  await initDb();
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?);', key, value);
}
