// BUG-005152: delete an unused listing without a fragile preliminary
// bookings COUNT/HEAD request. Migration 010's Postgres foreign keys are
// the authoritative safety boundary for booking and hold preservation.

export function listingDeletionFailureMessage(error) {
  const code = String(error?.code || "");
  if (code === "23503") {
    return "This driveway has bookings or checkout reservations and cannot be deleted. No reservation was removed.";
  }
  if (code === "42501" || code === "PGRST301") {
    return "Your account is not authorized to delete this listing. Please sign in as its Host.";
  }
  return "Couldn't delete listing. Nothing was deleted. Please try again or contact ParkShare support.";
}

export async function deleteHostListing(supabase, { listingId, hostId }) {
  if (!Number.isSafeInteger(Number(listingId)) || Number(listingId) <= 0 || !hostId) {
    return { ok: false, message: "Invalid listing or Host account. Nothing was deleted." };
  }
  try {
    // No /bookings?select=id count query here. Postgres ON DELETE RESTRICT
    // prevents any deletion that would erase booking/checkout records,
    // including when users call the REST endpoint directly.
    const { data, error } = await supabase
      .from("listings")
      .delete()
      .eq("id", Number(listingId))
      .eq("host_id", hostId)
      .select("id");
    if (error) return { ok: false, message: listingDeletionFailureMessage(error) };
    if (!Array.isArray(data) || !data.some(row => Number(row.id) === Number(listingId))) {
      return {
        ok: false,
        message: "The listing was not deleted. Check that you are its Host and try again.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Unable to reach the database. Nothing was deleted. Please try again." };
  }
}
