export async function fetchPublicParkingPage(cursor = null, signal, fetcher = fetch) {
  const response = await fetcher(cursor ? `/api/public-parking?cursor=${encodeURIComponent(cursor)}` : "/api/public-parking", { signal });
  if (!response.ok) throw new Error("Public listings unavailable");
  const payload = await response.json();
  if (!Array.isArray(payload.listings) || (payload.nextCursor != null
    && (!/^[1-9]\d*$/.test(payload.nextCursor) || !Number.isSafeInteger(Number(payload.nextCursor))
      || (cursor && Number(payload.nextCursor) >= Number(cursor))))) throw new Error("Unexpected parking response");
  return payload;
}
