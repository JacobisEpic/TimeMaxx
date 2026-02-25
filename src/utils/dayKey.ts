export function getLocalDayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function dayKeyToLocalDate(dayKey: string): Date | null {
  const match = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function shiftDayKey(dayKey: string, dayDelta: number): string {
  const baseDate = dayKeyToLocalDate(dayKey);

  if (!baseDate) {
    return dayKey;
  }

  const shifted = new Date(baseDate);
  shifted.setDate(shifted.getDate() + dayDelta);
  return getLocalDayKey(shifted);
}
