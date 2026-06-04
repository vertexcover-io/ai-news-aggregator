export function parseLocalDate(runDate: string): Date {
  return new Date(`${runDate}T00:00:00`);
}
