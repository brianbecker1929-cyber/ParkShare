// Render booking instants in the verified property timezone. Live callers
// pass UTC explicitly when an old booking has no verified zone snapshot.
// Instants remain untouched: this affects presentation, not duration or holds.
export const PARKING_EMAIL_TIME_ZONE = "America/Toronto";

function localCalendarDay(instant, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone,
  }).format(instant);
}

export function formatBookingEmailTimes(start, end, now = new Date(), timeZone = PARKING_EMAIL_TIME_ZONE) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const nowDate = new Date(now);
  if ([startDate, endDate, nowDate].some(date => Number.isNaN(date.getTime()))) {
    throw new TypeError("Booking email needs valid start, end, and current instants.");
  }

  if (typeof timeZone !== "string") throw new RangeError("Property time zone is required.");
  // Validate the IANA timezone before sending any timed email.
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(nowDate);
  const timeFmt = { hour: "numeric", minute: "2-digit", timeZone };
  const dateFmt = {
    weekday: "short", month: "long", day: "numeric", year: "numeric",
    timeZone,
  };
  const dayFmt = { weekday: "short", month: "short", day: "numeric", timeZone };
  const hostFmt = {
    dateStyle: "medium", timeStyle: "short", timeZone,
  };
  return {
    timeZone,
    timeZoneLabel: timeZone === "UTC" ? "UTC (property time zone not verified)" : `${timeZone} local time`,
    startDateLabel: localCalendarDay(startDate, timeZone) === localCalendarDay(nowDate, timeZone)
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
