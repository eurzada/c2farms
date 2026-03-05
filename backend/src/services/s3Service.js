import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';

const BUCKET = process.env.S3_BUCKET_NAME || 'c2farms-tickets';
const REGION = process.env.AWS_REGION || 'ca-central-1';

let s3Client;
function getClient() {
  if (!s3Client) {
    s3Client = new S3Client({ region: REGION });
  }
  return s3Client;
}

/**
 * Build the S3 key for a ticket photo.
 * Format: {farmId}/{year}/{ticketNumber}_{date}_{crop}.jpg
 */
function buildKey(farmId, ticketNumber, date, crop, suffix = '') {
  const year = date ? new Date(date).getFullYear() : new Date().getFullYear();
  const safeTicket = String(ticketNumber).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeCrop = crop ? String(crop).replace(/[^a-zA-Z0-9_-]/g, '_') : 'unknown';
  const dateStr = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  return `${farmId}/${year}/${safeTicket}_${dateStr}_${safeCrop}${suffix}.jpg`;
}

/**
 * Process an image buffer: fix EXIF orientation, strip GPS, resize.
 */
async function processImage(buffer, maxWidth) {
  return sharp(buffer)
    .rotate()           // auto-rotate based on EXIF
    .resize(maxWidth, null, { withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * Upload a ticket photo to S3.
 * Creates both full-size (max 2000px) and thumbnail (300px) versions.
 * Returns { photoUrl, thumbnailUrl, photoKey, thumbnailKey }.
 */
export async function uploadTicketPhoto(farmId, ticketNumber, date, crop, imageBuffer) {
  const client = getClient();

  const [fullImage, thumbImage] = await Promise.all([
    processImage(imageBuffer, 2000),
    processImage(imageBuffer, 300),
  ]);

  const fullKey = buildKey(farmId, ticketNumber, date, crop);
  const thumbKey = buildKey(farmId, ticketNumber, date, crop, '_thumb');

  await Promise.all([
    client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: fullKey,
      Body: fullImage,
      ContentType: 'image/jpeg',
    })),
    client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: thumbKey,
      Body: thumbImage,
      ContentType: 'image/jpeg',
    })),
  ]);

  const photoUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${fullKey}`;
  const thumbnailUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${thumbKey}`;

  return { photoUrl, thumbnailUrl, photoKey: fullKey, thumbnailKey: thumbKey };
}

/**
 * Generate a pre-signed URL for private bucket reads.
 * Expires in 1 hour by default.
 */
export async function generatePresignedUrl(key, expiresIn = 3600) {
  const client = getClient();
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(client, command, { expiresIn });
}
