export type Lane = 'planned' | 'actual';
export type BlockRepeatPreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
export type BlockRepeatEndMode = 'never' | 'onDate' | 'afterCount';
export type BlockMonthlyRepeatMode = 'dayOfMonth' | 'ordinalWeekday';
export type SeriesEditScope = 'this' | 'following' | 'all';

export type BlockRepeatRule = {
  preset: BlockRepeatPreset;
  interval: number;
  weekDays: number[];
  monthlyMode: BlockMonthlyRepeatMode;
  endMode: BlockRepeatEndMode;
  endDayKey: string;
  occurrenceCount: number;
};

export type Block = {
  id: string;
  startMin: number;
  endMin: number;
  title: string;
  tags: string[];
  lane: Lane;
  linkedPlannedId?: string | null;
  recurrenceId?: string | null;
  recurrenceIndex?: number | null;
  repeatRule?: BlockRepeatRule | null;
};
