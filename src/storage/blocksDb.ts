import * as SQLite from 'expo-sqlite';

import type { Block, BlockRepeatPreset, Lane } from '@/src/types/blocks';
import { normalizeRepeatRule } from '@/src/utils/recurrence';

const DB_NAME = 'timemaxx.db';
// Preserve existing user data after the app rename.
const LEGACY_DB_NAME = 'plan-vs-actual.db';
const SCHEMA_VERSION = '5';

const BLOCK_LANE_SORT_SQL = `CASE lane
  WHEN 'planned' THEN 0
  WHEN 'done' THEN 1
  WHEN 'actual' THEN 1
  ELSE 2
END`;

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
  if (lane === 'planned' || lane === 'done') {
    return lane;
  }

  if (lane === 'actual') {
    return 'done';
  }

  return null;
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
  dayKey: string;
  id: string;
  lane: string;
  startMin: number;
  endMin: number;
  title: string;
  tagsJson: string;
  linkedPlannedId: string | null;
  recurrenceId: string | null;
  recurrenceIndex: number | null;
  recurrenceRuleJson: string | null;
};

type StoredBlockRow = BlockRow & {
  updatedAt: number;
};

function parseRepeatPreset(value: unknown): BlockRepeatPreset {
  if (
    value === 'none' ||
    value === 'daily' ||
    value === 'weekdays' ||
    value === 'weekly' ||
    value === 'monthly' ||
    value === 'yearly'
  ) {
    return value;
  }

  return 'none';
}

function parseRepeatRule(recurrenceRuleJson: string | null, dayKey: string) {
  if (!recurrenceRuleJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(recurrenceRuleJson);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const nextRule = normalizeRepeatRule(
      {
        preset: parseRepeatPreset((parsed as { preset?: unknown }).preset),
        interval: Number((parsed as { interval?: unknown }).interval ?? 1),
        weekDays: Array.isArray((parsed as { weekDays?: unknown }).weekDays)
          ? ((parsed as { weekDays: unknown[] }).weekDays as number[])
          : [],
        monthlyMode:
          (parsed as { monthlyMode?: unknown }).monthlyMode === 'ordinalWeekday'
            ? 'ordinalWeekday'
            : 'dayOfMonth',
        endMode:
          (parsed as { endMode?: unknown }).endMode === 'never'
            ? 'never'
            : (parsed as { endMode?: unknown }).endMode === 'afterCount'
              ? 'afterCount'
              : 'onDate',
        endDayKey:
          typeof (parsed as { endDayKey?: unknown }).endDayKey === 'string'
            ? ((parsed as { endDayKey: string }).endDayKey as string)
            : dayKey,
        occurrenceCount: Number((parsed as { occurrenceCount?: unknown }).occurrenceCount ?? 10),
      },
      dayKey
    );

    return nextRule;
  } catch {
    return null;
  }
}

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
    linkedPlannedId: lane === 'done' ? row.linkedPlannedId : undefined,
    recurrenceId: row.recurrenceId,
    recurrenceIndex: row.recurrenceIndex,
    repeatRule: parseRepeatRule(row.recurrenceRuleJson, row.dayKey),
  };
}

async function migrateStoredDoneLaneIfNeeded(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.runAsync(`UPDATE blocks SET lane = 'done' WHERE lane = 'actual';`);
}

async function ensureSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      dayKey TEXT NOT NULL,
      lane TEXT NOT NULL,
      startMin INTEGER NOT NULL,
      endMin INTEGER NOT NULL,
      title TEXT NOT NULL,
      tagsJson TEXT NOT NULL,
      linkedPlannedId TEXT NULL,
      recurrenceId TEXT NULL,
      recurrenceIndex INTEGER NULL,
      recurrenceRuleJson TEXT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_day_lane_start
      ON blocks(dayKey, lane, startMin);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(blocks);');
  const hasLinkedPlannedId = columns.some((column) => column.name === 'linkedPlannedId');
  const hasRecurrenceId = columns.some((column) => column.name === 'recurrenceId');
  const hasRecurrenceIndex = columns.some((column) => column.name === 'recurrenceIndex');
  const hasRecurrenceRuleJson = columns.some((column) => column.name === 'recurrenceRuleJson');

  if (!hasLinkedPlannedId) {
    await db.execAsync('ALTER TABLE blocks ADD COLUMN linkedPlannedId TEXT NULL;');
  }
  if (!hasRecurrenceId) {
    await db.execAsync('ALTER TABLE blocks ADD COLUMN recurrenceId TEXT NULL;');
  }
  if (!hasRecurrenceIndex) {
    await db.execAsync('ALTER TABLE blocks ADD COLUMN recurrenceIndex INTEGER NULL;');
  }
  if (!hasRecurrenceRuleJson) {
    await db.execAsync('ALTER TABLE blocks ADD COLUMN recurrenceRuleJson TEXT NULL;');
  }
}

async function getBlockCount(db: SQLite.SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<{ count: number }>('SELECT COUNT(*) as count FROM blocks;');
  return Number(rows[0]?.count ?? 0);
}

async function migrateLegacyDatabaseIfNeeded(db: SQLite.SQLiteDatabase): Promise<void> {
  const currentBlockCount = await getBlockCount(db);
  if (currentBlockCount > 0) {
    return;
  }

  const legacyDb = await SQLite.openDatabaseAsync(LEGACY_DB_NAME);
  let shouldDeleteLegacy = false;

  try {
    await ensureSchema(legacyDb);

    const legacyBlockCount = await getBlockCount(legacyDb);
    if (legacyBlockCount === 0) {
      shouldDeleteLegacy = true;
      return;
    }

    const legacyRows = await legacyDb.getAllAsync<StoredBlockRow>(
      `SELECT id, dayKey, lane, startMin, endMin, title, tagsJson, linkedPlannedId, recurrenceId, recurrenceIndex, recurrenceRuleJson, updatedAt
       FROM blocks
       ORDER BY dayKey ASC, ${BLOCK_LANE_SORT_SQL}, startMin ASC, id ASC;`
    );

    await db.execAsync('BEGIN IMMEDIATE TRANSACTION;');
    try {
      for (const row of legacyRows) {
        const lane = parseLane(row.lane);
        if (!lane) {
          continue;
        }

        await db.runAsync(
          `INSERT OR REPLACE INTO blocks (id, dayKey, lane, startMin, endMin, title, tagsJson, linkedPlannedId, recurrenceId, recurrenceIndex, recurrenceRuleJson, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          row.id,
          row.dayKey,
          lane,
          row.startMin,
          row.endMin,
          row.title,
          row.tagsJson,
          lane === 'done' ? row.linkedPlannedId : null,
          row.recurrenceId,
          row.recurrenceIndex,
          row.recurrenceRuleJson,
          Number.isFinite(row.updatedAt) ? row.updatedAt : Date.now()
        );
      }
      await db.execAsync('COMMIT;');
      shouldDeleteLegacy = true;
    } catch (error) {
      await db.execAsync('ROLLBACK;');
      throw error;
    }
  } finally {
    await legacyDb.closeAsync();

    if (shouldDeleteLegacy) {
      try {
        await SQLite.deleteDatabaseAsync(LEGACY_DB_NAME);
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
}

export async function initDb(): Promise<void> {
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    const db = await getDb();
    await ensureSchema(db);
    await migrateLegacyDatabaseIfNeeded(db);
    await migrateStoredDoneLaneIfNeeded(db);

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
    `SELECT dayKey, id, lane, startMin, endMin, title, tagsJson, linkedPlannedId, recurrenceId, recurrenceIndex, recurrenceRuleJson
     FROM blocks
     WHERE dayKey = ?
     ORDER BY ${BLOCK_LANE_SORT_SQL}, startMin ASC, id ASC;`,
    dayKey
  );

  return rows
    .map((row) => mapRowToBlock(row))
    .filter((block): block is Block => block !== null);
}

export async function getBlocksForDayRange(dayKeyStart: string, dayKeyEnd: string): Promise<Record<string, Block[]>> {
  await initDb();
  const db = await getDb();
  const rows = await db.getAllAsync<BlockRow>(
    `SELECT dayKey, id, lane, startMin, endMin, title, tagsJson, linkedPlannedId, recurrenceId, recurrenceIndex, recurrenceRuleJson
     FROM blocks
     WHERE dayKey >= ? AND dayKey <= ?
     ORDER BY dayKey ASC, ${BLOCK_LANE_SORT_SQL}, startMin ASC, id ASC;`,
    dayKeyStart,
    dayKeyEnd
  );

  const blocksByDay: Record<string, Block[]> = {};

  for (const row of rows) {
    const block = mapRowToBlock(row);

    if (!block) {
      continue;
    }

    if (!blocksByDay[row.dayKey]) {
      blocksByDay[row.dayKey] = [];
    }

    blocksByDay[row.dayKey].push(block);
  }

  return blocksByDay;
}

export async function getAllBlocksByDay(): Promise<Record<string, Block[]>> {
  await initDb();
  const db = await getDb();
  const rows = await db.getAllAsync<BlockRow>(
    `SELECT dayKey, id, lane, startMin, endMin, title, tagsJson, linkedPlannedId, recurrenceId, recurrenceIndex, recurrenceRuleJson
     FROM blocks
     ORDER BY dayKey ASC, ${BLOCK_LANE_SORT_SQL}, startMin ASC, id ASC;`
  );

  const blocksByDay: Record<string, Block[]> = {};

  for (const row of rows) {
    const block = mapRowToBlock(row);

    if (!block) {
      continue;
    }

    if (!blocksByDay[row.dayKey]) {
      blocksByDay[row.dayKey] = [];
    }

    blocksByDay[row.dayKey].push(block);
  }

  return blocksByDay;
}

export type BlockWithDayKey = {
  dayKey: string;
  block: Block;
};

export async function getBlocksForRecurrence(recurrenceId: string): Promise<BlockWithDayKey[]> {
  await initDb();
  const db = await getDb();
  const rows = await db.getAllAsync<BlockRow>(
    `SELECT dayKey, id, lane, startMin, endMin, title, tagsJson, linkedPlannedId, recurrenceId, recurrenceIndex, recurrenceRuleJson
     FROM blocks
     WHERE recurrenceId = ?
     ORDER BY recurrenceIndex ASC, dayKey ASC, ${BLOCK_LANE_SORT_SQL}, startMin ASC, id ASC;`,
    recurrenceId
  );

  const results: BlockWithDayKey[] = [];

  for (const row of rows) {
    const block = mapRowToBlock(row);
    if (!block) {
      continue;
    }

    results.push({
      dayKey: row.dayKey,
      block,
    });
  }

  return results;
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
    `INSERT INTO blocks (id, dayKey, lane, startMin, endMin, title, tagsJson, linkedPlannedId, recurrenceId, recurrenceIndex, recurrenceRuleJson, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    id,
    dayKey,
    input.lane,
    input.startMin,
    input.endMin,
    input.title,
    JSON.stringify(input.tags),
    input.lane === 'done' ? input.linkedPlannedId ?? null : null,
    input.recurrenceId ?? null,
    input.recurrenceIndex ?? null,
    input.repeatRule ? JSON.stringify(input.repeatRule) : null,
    now
  );

  return {
    id,
    lane: input.lane,
    startMin: input.startMin,
    endMin: input.endMin,
    title: input.title,
    tags: input.tags,
    linkedPlannedId: input.lane === 'done' ? input.linkedPlannedId ?? null : undefined,
    recurrenceId: input.recurrenceId ?? null,
    recurrenceIndex: input.recurrenceIndex ?? null,
    repeatRule: input.repeatRule ?? null,
  };
}

export async function updateBlock(block: Block, dayKey: string): Promise<void> {
  await initDb();
  const db = await getDb();
  const now = Date.now();

  await db.runAsync(
    `UPDATE blocks
      SET lane = ?, startMin = ?, endMin = ?, title = ?, tagsJson = ?, linkedPlannedId = ?, recurrenceId = ?, recurrenceIndex = ?, recurrenceRuleJson = ?, updatedAt = ?
      WHERE id = ? AND dayKey = ?;`,
    block.lane,
    block.startMin,
    block.endMin,
    block.title,
    JSON.stringify(block.tags),
    block.lane === 'done' ? block.linkedPlannedId ?? null : null,
    block.recurrenceId ?? null,
    block.recurrenceIndex ?? null,
    block.repeatRule ? JSON.stringify(block.repeatRule) : null,
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
