import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock AWS SDK before importing
const sendMock = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = sendMock; },
  PutObjectCommand: class { constructor(params) { Object.assign(this, params); } },
  GetObjectCommand: class { constructor(params) { Object.assign(this, params); } },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com/photo.jpg'),
}));

vi.mock('sharp', () => {
  const instance = {
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('processed-image')),
  };
  return { default: vi.fn(() => instance) };
});

describe('s3Service', () => {
  let uploadTicketPhoto, generatePresignedUrl;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./s3Service.js');
    uploadTicketPhoto = mod.uploadTicketPhoto;
    generatePresignedUrl = mod.generatePresignedUrl;
  });

  describe('uploadTicketPhoto', () => {
    it('returns photoUrl and thumbnailUrl', async () => {
      const buf = Buffer.from('test-image');
      const result = await uploadTicketPhoto('farm1', 'TKT-001', '2026-03-01', 'Canola', buf);

      expect(result).toHaveProperty('photoUrl');
      expect(result).toHaveProperty('thumbnailUrl');
      expect(result.photoUrl).toContain('farm1');
      expect(result.photoUrl).toContain('TKT-001');
      expect(result.photoUrl).toContain('Canola');
      expect(result.thumbnailUrl).toContain('_thumb');
    });

    it('sanitizes special characters in key components', async () => {
      const buf = Buffer.from('test-image');
      const result = await uploadTicketPhoto('farm1', 'TKT/001 bad', '2026-03-01', 'Red Lentils', buf);

      expect(result.photoUrl).not.toContain('/001 bad');
      expect(result.photoUrl).toContain('TKT_001_bad');
    });

    it('handles missing crop gracefully', async () => {
      const buf = Buffer.from('test-image');
      const result = await uploadTicketPhoto('farm1', 'TKT-001', '2026-03-01', null, buf);

      expect(result.photoUrl).toContain('unknown');
    });
  });

  describe('generatePresignedUrl', () => {
    it('returns a signed URL', async () => {
      const url = await generatePresignedUrl('farm1/2026/TKT-001.jpg');
      expect(url).toBe('https://signed-url.example.com/photo.jpg');
    });
  });
});
