// Render every customer-facing booking email date/time in the same local
// timezone as ParkShare's Toronto-area booking display, never Vercel's UTC.
// Instants remain untouched: this affects presentation, not duration or holds.
export const PARKING_EMAIL_TIME_ZONE = "America/Toronto";

function torontoCalendarDay(instant) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: PARKING_EMAIL_TIME_ZONE,
  }).format(instant);
}

export function formatBookingEmailTimes(start, end, now = new Date()) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const nowDate = new Date(now);
  if ([startDate, endDate, nowDate].some(date => Number.isNaN(date.getTime()))) {
    throw new TypeError("Booking email needs valid start, end, and current instants.");
  }

  const timeFmt = { hour: "numeric", minute: "2-digit", timeZone: PARKING_EMAIL_TIME_ZONE };
  const dateFmt = {
    weekday: "short", month: "long", day: "numeric", year: "numeric",
    timeZone: PARKING_EMAIL_TIME_ZONE,
  };
  const dayFmt = { weekday: "short", month: "short", day: "numeric", timeZone: PARKING_EMAIL_TIME_ZONE };
  const hostFmt = {
    dateStyle: "medium", timeStyle: "short", timeZone: PARKING_EMAIL_TIME_ZONE,
  };
  return {
    startDateLabel: torontoCalendarDay(startDate) === torontoCalendarDay(nowDate)
      ? "Today"
      : startDate.toLocaleDateString("en-CA", dayFmt),
    startTimeStr: startDate.toLocaleTimeString("en-CA", timeFmt),
    entryDateFull: startDate.toLocaleDateString("en-CA", dateFmt),
    endTimeStr: endDate.toLocaleTimeString("en-CA", timeFmt),
    exitDateFull: endDate.toLocaleDateString("en-CA", dateFmt),
    hostStartLabel: startDate.toLocaleString("en-CA", hostFmt),
    hostEndLabel: endDate.toLocaleString("en-CA", hostFmt),
  };
}
