// A payment date is not a parking date. Keep financial ordering based on the
// original payment instant and render both explicitly in the stored property
// zone, never the travelling viewer's device zone. No historic data is moved.
export function transactionDateDetails(transaction) {
  let timeZone = transaction.propertyTimeZone || "UTC";
  let verifiedZone = Boolean(transaction.propertyTimeZone);
  try { new Intl.DateTimeFormat("en-CA", { timeZone }).format(0); }
  catch { timeZone = "UTC"; verifiedZone = false; }
  const format = value => {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone, month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    }).format(date);
  };
  const paid = format(transaction.date);
  const parking = transaction.type === "booking" ? format(transaction.bookingStart) : null;
  return {
    paid: paid ? `Paid ${paid}` : "Payment date unavailable",
    parking: transaction.type === "booking" ? parking ? `Parking ${parking}` : "Parking date unavailable" : null,
    zone: verifiedZone ? `${timeZone} local time` : "UTC (property time zone unavailable)",
  };
}
