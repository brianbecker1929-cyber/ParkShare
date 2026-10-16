// BUG-005135 — Upload driveway photos into dedicated Supabase Storage.
// Database listing records store only short public image URLs, never Base64.
// Legacy listing records with embedded images continue to render as before.

export const LISTING_PHOTO_BUCKET = "listing-photos";
export const MAX_LISTING_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_LISTING_PHOTOS = 6;

// Covers both existing Base64 images and the HTTPS public Storage URLs
// written by this release. Never render a URL as placeholder text.
export function isListingImageUrl(value) {
  if (typeof value !== "string") return false;
  return /^data:image\/(?:jpeg|png|webp);base64,/i.test(value)
    || /^https:\/\/[^\s]+$/i.test(value);
}

export const ALLOWED_LISTING_PHOTO_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

export function validateListingPhoto(file) {
  if (!file || typeof file.size !== "number" || !file.type) {
    return "Select a JPEG, PNG, or WebP driveway photo.";
  }
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_LISTING_PHOTO_TYPES, file.type)) {
    return "Unsupported photo format. Use JPEG, PNG, or WebP.";
  }
  if (file.size <= 0) return "The selected photo is empty.";
  if (file.size > MAX_LISTING_PHOTO_BYTES) {
    return "Photo exceeds the 10 MB limit. Choose a smaller image.";
  }
  return null;
}

export function listingPhotoPath(hostId, file, uuid) {
  const host = String(hostId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(host)) {
    throw new Error("Sign in with a valid Host account to upload photos.");
  }
  const validationError = validateListingPhoto(file);
  if (validationError) throw new Error(validationError);
  const id = String(uuid || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("Unable to create a unique photo path.");
  }
  return `${host}/${id}.${ALLOWED_LISTING_PHOTO_TYPES[file.type]}`;
}

export async function removeUploadedListingPhotos(supabase, paths) {
  if (!paths?.length) return;
  const result = await supabase.storage.from(LISTING_PHOTO_BUCKET).remove(paths);
  if (result.error) throw result.error;
}

export async function uploadListingPhotos(supabase, hostId, photoDrafts, onProgress = () => {}, randomId = () => globalThis.crypto?.randomUUID?.()) {
  if (!Array.isArray(photoDrafts) || photoDrafts.length === 0 || photoDrafts.length > MAX_LISTING_PHOTOS) {
    throw new Error("Upload between one and six driveway photos.");
  }
  const uploadedPaths = [];
  const publicUrls = [];
  try {
    for (let i = 0; i < photoDrafts.length; i++) {
      const file = photoDrafts[i]?.file;
      const validationError = validateListingPhoto(file);
      if (validationError) throw new Error(`Photo ${i + 1}: ${validationError}`);
      const uuid = randomId();
      const path = listingPhotoPath(hostId, file, uuid);
      onProgress(i + 1, photoDrafts.length);
      const storage = supabase.storage.from(LISTING_PHOTO_BUCKET);
      const { error } = await storage.upload(path, file, {
        contentType: file.type,
        upsert: false,
        cacheControl: "3600",
      });
      if (error) throw new Error(`Photo ${i + 1} couldn't upload: ${error.message || "Storage request failed"}`);
      uploadedPaths.push(path);
      const { data } = storage.getPublicUrl(path);
      if (!data?.publicUrl?.startsWith("https://")) throw new Error("Photo upload did not return a public URL.");
      publicUrls.push(data.publicUrl);
    }
    return { urls: publicUrls, paths: uploadedPaths };
  } catch (error) {
    try {
      await removeUploadedListingPhotos(supabase, uploadedPaths);
    } catch (cleanupError) {
      console.warn("Unable to clean up interrupted listing photo upload", cleanupError);
    }
    throw error;
  }
}
