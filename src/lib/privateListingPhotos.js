// Signed-in listing photos use an Authorization header, never a public
// static img URL, token in query parameters, or shared caches.
export async function fetchPrivateCoverDataUrl(listingId, bookingId, accessToken, signal) {
  if (!accessToken || !Number.isSafeInteger(Number(listingId)) || Number(listingId) <= 0) return null;
  const params = new URLSearchParams({ listingId: String(listingId) });
  if (bookingId) params.set("bookingId", String(bookingId));
  const response = await fetch("/api/listing-cover?" + params, {
    headers: { Authorization: "Bearer " + accessToken },
    cache: "no-store",
    signal,
  });
  if (!response.ok) return null;
  const blob = await response.blob();
  if (blob.type !== "image/webp" || blob.size > 2 * 1024 * 1024) return null;
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read authorized listing photo"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(blob);
  });
}
