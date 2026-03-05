import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  function MockAnthropic() {
    this.messages = { create: mockCreate };
  }
  return { default: MockAnthropic };
});

describe('ticketVisionService', () => {
  let extractTicketFromPhoto;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const mod = await import('./ticketVisionService.js');
    extractTicketFromPhoto = mod.extractTicketFromPhoto;
  });

  it('extracts structured data from a photo', async () => {
    mockCreate.mockResolvedValue({
      content: [{
        text: JSON.stringify({
          ticket_number: 'TKT-001',
          delivery_date: '2026-03-01',
          crop: 'Canola',
          net_weight_kg: 34500,
          gross_weight_kg: 48000,
          tare_weight_kg: 13500,
          moisture_pct: 8.2,
          grade: '1CW',
          confidence: 0.92,
        }),
      }],
    });

    const result = await extractTicketFromPhoto(Buffer.from('fake-image'));

    expect(result.extraction.ticket_number).toBe('TKT-001');
    expect(result.extraction.crop).toBe('Canola');
    expect(result.extraction.net_weight_kg).toBe(34500);
    expect(result.confidence).toBe(0.92);
    // confidence should be removed from extraction object
    expect(result.extraction.confidence).toBeUndefined();
  });

  it('handles markdown code block wrapped response', async () => {
    mockCreate.mockResolvedValue({
      content: [{
        text: '```json\n{"ticket_number": "TKT-002", "net_weight_kg": 20000, "confidence": 0.75}\n```',
      }],
    });

    const result = await extractTicketFromPhoto(Buffer.from('fake-image'));
    expect(result.extraction.ticket_number).toBe('TKT-002');
    expect(result.confidence).toBe(0.75);
  });

  it('throws on unparseable response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ text: 'Sorry, I cannot read this image.' }],
    });

    await expect(extractTicketFromPhoto(Buffer.from('fake-image')))
      .rejects.toThrow('Failed to parse Claude extraction response');
  });

  it('uses 0.5 default confidence when not provided', async () => {
    mockCreate.mockResolvedValue({
      content: [{ text: '{"ticket_number": "TKT-003", "net_weight_kg": 15000}' }],
    });

    const result = await extractTicketFromPhoto(Buffer.from('fake-image'));
    expect(result.confidence).toBe(0.5);
  });

  it('sends image as base64 to Claude API', async () => {
    mockCreate.mockResolvedValue({
      content: [{ text: '{"ticket_number": "X", "confidence": 0.5}' }],
    });

    const imageBuffer = Buffer.from('test-image-data');
    await extractTicketFromPhoto(imageBuffer);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content[0].type).toBe('image');
    expect(callArgs.messages[0].content[0].source.type).toBe('base64');
    expect(callArgs.messages[0].content[0].source.data).toBe(imageBuffer.toString('base64'));
  });
});
