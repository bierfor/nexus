import { Readable } from "node:stream";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";

export function ensureCloudinaryConfigured(): void {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error(
      "Configura CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET",
    );
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
}

export async function uploadImageBuffer(
  buffer: Buffer,
  originalName: string,
): Promise<{ url: string; publicId: string }> {
  ensureCloudinaryConfigured();
  const stem =
    path.basename(originalName, path.extname(originalName)).replace(/[^\w-]/g, "-") || "cover";

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "puro-flusso/covers",
        public_id: `${stem}-${Date.now()}`,
        resource_type: "image",
      },
      (err, result) => {
        if (err || !result?.secure_url) {
          reject(err ?? new Error("Cloudinary no devolvió URL"));
          return;
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    Readable.from(buffer).pipe(stream);
  });
}
