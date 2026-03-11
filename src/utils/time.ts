const MINUTES_PER_DAY = 24 * 60;
type FormatAmPmOptions = {
  includePeriod?: boolean;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function roundTo15(min: number): number {
  return Math.round(min / 15) * 15;
}

export function parseHHMM(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }

  if (hour === 24 && minute === 0) {
    return MINUTES_PER_DAY;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

export function formatHHMM(min: number): string {
  const clamped = clamp(Math.round(min), 0, MINUTES_PER_DAY);

  if (clamped === MINUTES_PER_DAY) {
    return '24:00';
  }

  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatMinutesAmPm(min: number, options: FormatAmPmOptions = {}): string {
  const { includePeriod = true } = options;
  const clamped = clamp(Math.round(min), 0, MINUTES_PER_DAY);
  const safe = clamped === MINUTES_PER_DAY ? 0 : clamped;
  const hours24 = Math.floor(safe / 60);
  const minutes = safe % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const baseLabel = `${hours12}:${String(minutes).padStart(2, '0')}`;

  return includePeriod ? `${baseLabel} ${period}` : baseLabel;
}

export function parseTimeText(value: string): number | null {
  const trimmed = value.trim();
  const amPmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);

  if (amPmMatch) {
    const hour12 = Number(amPmMatch[1]);
    const minute = Number(amPmMatch[2]);
    const period = amPmMatch[3].toUpperCase();

    if (
      !Number.isInteger(hour12) ||
      !Number.isInteger(minute) ||
      hour12 < 1 ||
      hour12 > 12 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }

    const hour24 = (hour12 % 12) + (period === 'PM' ? 12 : 0);
    return hour24 * 60 + minute;
  }

  return parseHHMM(trimmed);
}

export function formatDuration(min: number): string {
  const absMin = Math.abs(min);
  const hours = Math.floor(absMin / 60);
  const minutes = absMin % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}
