export function getBookingDisplayStatus(status, bookingStart, bookingEnd, currentTime = Date.now()) {
  const normalisedStatus = String(status || "");
  if (normalisedStatus !== "Upcoming" && normalisedStatus !== "Active") return normalisedStatus;

  const startTime = new Date(bookingStart).getTime();
  const endTime = new Date(bookingEnd).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return normalisedStatus;
  if (endTime <= currentTime) return "Completed";
  if (startTime <= currentTime) return "Active";
  return "Upcoming";
}

export function formatBookingTimeRemaining(bookingEnd, currentTime = Date.now()) {
  const endTime = new Date(bookingEnd).getTime();
  if (!Number.isFinite(endTime)) return "—";

  const totalSeconds = Math.max(0, Math.ceil((endTime - currentTime) / 1000));
  if (totalSeconds === 0) return "Ended";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
