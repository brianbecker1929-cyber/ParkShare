// Add paid, applied extensions for display without changing the original
// booking charge used by the refund and earnings ledgers.
export async function withBookingChargeTotals(db, bookings) {
  if (!bookings.length) return [];
  const ids = [...new Set(bookings.map(row => row.id))];
  const amounts = new Map();
  const paidStatuses = new Set(["confirmed", "completed", "partially_refunded", "refunded", "refund_pending", "disputed"]);
  // Explicit pages avoid silently truncating totals at the Data API row cap.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("booking_extensions")
      .select("booking_id,added_amount,application_state,paid_at,status")
      .in("booking_id", ids).eq("application_state", "applied")
      .not("paid_at", "is", null).order("id", { ascending: true }).range(offset, offset + 999);
    if (error) throw error;
    for (const row of data || []) {
      if (row.application_state !== "applied" || !row.paid_at || !paidStatuses.has(row.status)) continue;
      const cents = Math.round(Number(row.added_amount) * 100);
      if (row.added_amount == null || !Number.isSafeInteger(cents) || cents < 0) throw new Error("Invalid extension total");
      const key = String(row.booking_id);
      amounts.set(key, (amounts.get(key) || 0) + cents);
    }
    if ((data || []).length < 1000) break;
  }
  return bookings.map(row => {
    const cents = row.total == null ? null : Math.round(Number(row.total) * 100);
    if (cents !== null && (!Number.isSafeInteger(cents) || cents < 0)) throw new Error("Invalid booking total");
    return { ...row, charged_total: cents === null ? null : (cents + (amounts.get(String(row.id)) || 0)) / 100 };
  });
}
