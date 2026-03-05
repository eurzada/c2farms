/**
 * Delivery ticket photo extraction via Claude Vision.
 *
 * Takes a JPEG photo of a grain delivery ticket and extracts structured data.
 * Handles handwritten, rotated, and creased photos.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */

async function getAnthropicClient() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const EXTRACTION_PROMPT = `You are extracting data from a photograph of a grain delivery ticket from western Canada.
The photo may be handwritten, rotated, creased, or partially obscured. Do your best to extract all visible fields.

Extract into this JSON structure:
{
  "ticket_number": "string — the ticket or scale number printed/written on the ticket",
  "delivery_date": "YYYY-MM-DD — date of delivery",
  "crop": "string — grain type (e.g. Canola, Durum, Chickpeas, Lentils, Wheat, Barley, Oats, Peas, Flax, Mustard)",
  "gross_weight_kg": number or null,
  "tare_weight_kg": number or null,
  "net_weight_kg": number or null,
  "moisture_pct": number or null,
  "grade": "string or null — grain grade (e.g. 1CW, 2CWAD, #1, etc.)",
  "dockage_pct": number or null,
  "protein_pct": number or null,
  "operator_name": "string or null — driver/trucker name",
  "vehicle": "string or null — truck/trailer number",
  "destination": "string or null — delivery point/elevator",
  "buyer": "string or null — company receiving the grain",
  "contract_number": "string or null — if a contract ref is visible",
  "load_id": "string or null — load number or BOL",
  "origin": "string or null — farm/field origin if shown",
  "lot": "string or null — lot number if shown",
  "notes": "string or null — any other notable text on the ticket"
}

UNIT CONVERSION RULES:
- If weights are in lbs, convert to kg (lbs × 0.453592)
- If weights are in MT (metric tonnes), convert to kg (MT × 1000)
- Canadian tickets commonly show kg or lbs
- Net weight = Gross - Tare (compute if only two of three are given)

CONFIDENCE: Also return a "confidence" field (0.0 to 1.0) indicating your overall confidence in the extraction accuracy.
- 1.0 = perfectly clear, all fields readable
- 0.7-0.9 = most fields clear, some uncertain
- 0.4-0.6 = partially readable, some guessing required
- Below 0.4 = very poor quality, many fields uncertain

Return ONLY valid JSON with the fields above plus "confidence". No extra text.`;

/**
 * Extract delivery ticket data from a photo buffer.
 * Returns { extraction, confidence }.
 */
export async function extractTicketFromPhoto(imageBuffer) {
  const base64 = imageBuffer.toString('base64');
  const client = await getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
        },
        { type: 'text', text: EXTRACTION_PROMPT },
      ],
    }],
  });

  const text = response.content[0]?.text || '';

  let extraction;
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    extraction = JSON.parse(jsonMatch[1].trim());
  } catch {
    throw new Error(`Failed to parse Claude extraction response: ${text.substring(0, 200)}`);
  }

  const confidence = typeof extraction.confidence === 'number' ? extraction.confidence : 0.5;
  delete extraction.confidence;

  return { extraction, confidence };
}
