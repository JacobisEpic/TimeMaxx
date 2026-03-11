import type { BlockMonthlyRepeatMode, BlockRepeatRule } from '../types/blocks';
import { dayKeyToLocalDate, shiftDayKey } from './dayKey';

const MAX_NEVER_REPEAT_DAYS = 365;
const MIN_INTERVAL = 1;
const MAX_INTERVAL = 99;
const MIN_OCCURRENCES = 1;
const MAX_OCCURRENCES = 365;

type RepeatBuildResult = {
  dayKeys: string[];
  truncated: boolean;
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function getUtcDayStamp(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDaysBetween(fromDate: Date, toDate: Date): number {
  const ms = getUtcDayStamp(toDate) - getUtcDayStamp(fromDate);
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function getMonthDiff(startDate: Date, date: Date): number {
  return (date.getFullYear() - startDate.getFullYear()) * 12 + (date.getMonth() - startDate.getMonth());
}

function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getOrdinalWeekInfo(date: Date): { ordinal: number; isLast: boolean } {
  const dayOfMonth = date.getDate();
  const ordinal = Math.floor((dayOfMonth - 1) / 7) + 1;
  const isLast = dayOfMonth + 7 > getDaysInMonth(date.getFullYear(), date.getMonth());
  return { ordinal, isLast };
}

function matchesMonthlyOrdinal(date: Date, startDate: Date): boolean {
  if (date.getDay() !== startDate.getDay()) {
    return false;
  }

  const startInfo = getOrdinalWeekInfo(startDate);
  const dateInfo = getOrdinalWeekInfo(date);
  return startInfo.isLast ? dateInfo.isLast : startInfo.ordinal === dateInfo.ordinal;
}

function matchesMonthlyDate(date: Date, startDate: Date): boolean {
  const targetDay = Math.min(startDate.getDate(), getDaysInMonth(date.getFullYear(), date.getMonth()));
  return date.getDate() === targetDay;
}

function matchesYearlyDate(date: Date, startDate: Date): boolean {
  if (date.getMonth() !== startDate.getMonth()) {
    return false;
  }

  const targetDay = Math.min(startDate.getDate(), getDaysInMonth(date.getFullYear(), date.getMonth()));
  return date.getDate() === targetDay;
}

function normalizeWeekDays(weekDays: number[], fallbackDay: number): number[] {
  const unique = Array.from(
    new Set(
      weekDays.filter(
        (value) => Number.isInteger(value) && value >= 0 && value <= 6
      )
    )
  ).sort((a, b) => a - b);

  if (unique.length > 0) {
    return unique;
  }

  return [fallbackDay];
}

export function normalizeRepeatRule(rule: BlockRepeatRule, startDayKey: string): BlockRepeatRule {
  const startDate = dayKeyToLocalDate(startDayKey);
  const startDayOfWeek = startDate?.getDay() ?? 0;
  const monthlyMode: BlockMonthlyRepeatMode =
    rule.monthlyMode === 'ordinalWeekday' ? 'ordinalWeekday' : 'dayOfMonth';

  const endDayKey =
    typeof rule.endDayKey === 'string' && dayKeyToLocalDate(rule.endDayKey) ? rule.endDayKey : startDayKey;

  return {
    preset: rule.preset,
    interval: clampInt(rule.interval, MIN_INTERVAL, MAX_INTERVAL),
    weekDays: normalizeWeekDays(rule.weekDays, startDayOfWeek),
    monthlyMode,
    endMode: rule.endMode,
    endDayKey,
    occurrenceCount: clampInt(rule.occurrenceCount, MIN_OCCURRENCES, MAX_OCCURRENCES),
  };
}

function matchesRuleOnDate(dayKey: string, date: Date, startDate: Date, rule: BlockRepeatRule): boolean {
  const daysBetween = getDaysBetween(startDate, date);
  if (daysBetween < 0) {
    return false;
  }

  if (rule.preset === 'daily') {
    return daysBetween % rule.interval === 0;
  }

  if (rule.preset === 'weekdays') {
    if (date.getDay() < 1 || date.getDay() > 5) {
      return false;
    }
    const weekOffset = Math.floor(daysBetween / 7);
    return weekOffset % rule.interval === 0;
  }

  if (rule.preset === 'weekly') {
    if (!rule.weekDays.includes(date.getDay())) {
      return false;
    }

    const weekOffset = Math.floor(daysBetween / 7);
    return weekOffset % rule.interval === 0;
  }

  if (rule.preset === 'monthly') {
    const monthDiff = getMonthDiff(startDate, date);
    if (monthDiff < 0 || monthDiff % rule.interval !== 0) {
      return false;
    }

    return rule.monthlyMode === 'ordinalWeekday'
      ? matchesMonthlyOrdinal(date, startDate)
      : matchesMonthlyDate(date, startDate);
  }

  if (rule.preset === 'yearly') {
    const yearDiff = date.getFullYear() - startDate.getFullYear();
    if (yearDiff < 0 || yearDiff % rule.interval !== 0) {
      return false;
    }

    return matchesYearlyDate(date, startDate);
  }

  return dayKey === `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
}

export function buildRepeatDayKeys(startDayKey: string, ruleInput: BlockRepeatRule): RepeatBuildResult {
  if (ruleInput.preset === 'none') {
    return { dayKeys: [startDayKey], truncated: false };
  }

  const startDate = dayKeyToLocalDate(startDayKey);
  if (!startDate) {
    return { dayKeys: [], truncated: false };
  }

  const rule = normalizeRepeatRule(ruleInput, startDayKey);
  if (rule.endMode === 'onDate' && rule.endDayKey < startDayKey) {
    return { dayKeys: [], truncated: false };
  }

  const dayKeys: string[] = [];
  let cursorDayKey = startDayKey;
  let truncated = false;
  let iterations = 0;
  const maxIterations =
    rule.endMode === 'onDate'
      ? Math.max(1, getDaysBetween(startDate, dayKeyToLocalDate(rule.endDayKey) ?? startDate) + 2)
      : rule.endMode === 'afterCount'
        ? rule.occurrenceCount * 370
        : MAX_NEVER_REPEAT_DAYS + 2;

  while (iterations < maxIterations) {
    const cursorDate = dayKeyToLocalDate(cursorDayKey);
    if (!cursorDate) {
      break;
    }

    if (rule.endMode === 'onDate' && cursorDayKey > rule.endDayKey) {
      break;
    }
    if (rule.endMode === 'never' && getDaysBetween(startDate, cursorDate) > MAX_NEVER_REPEAT_DAYS) {
      truncated = true;
      break;
    }

    if (matchesRuleOnDate(cursorDayKey, cursorDate, startDate, rule)) {
      dayKeys.push(cursorDayKey);
      if (rule.endMode === 'afterCount' && dayKeys.length >= rule.occurrenceCount) {
        break;
      }
    }

    const nextDayKey = shiftDayKey(cursorDayKey, 1);
    if (nextDayKey === cursorDayKey) {
      break;
    }
    cursorDayKey = nextDayKey;
    iterations += 1;
  }

  if (rule.endMode === 'afterCount' && dayKeys.length < rule.occurrenceCount) {
    truncated = true;
  }

  return { dayKeys, truncated };
}
