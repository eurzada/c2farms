import { Router } from 'express';
import PdfPrinter from 'pdfmake';
import { existsSync } from 'fs';
import { authenticate } from '../middleware/auth.js';
import {
  generateInventoryExcel, generateInventoryPdf, generateInventoryCsv,
} from '../services/inventoryExportService.js';

const router = Router();

// Reuse font discovery from exports.js
function getFontPaths() {
  const candidates = [
    {
      normal: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      bold: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      italics: '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf',
      bolditalics: '/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf',
    },
    {
      normal: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      italics: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf',
      bolditalics: '/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf',
    },
  ];
  for (const fonts of candidates) {
    if (existsSync(fonts.normal)) return fonts;
  }
  return candidates[0];
}

const printer = new PdfPrinter({ Roboto: getFontPaths() });

// POST Excel export
router.post('/:farmId/inventory/export/excel', authenticate, async (req, res, next) => {
  try {
    const workbook = await generateInventoryExcel(req.params.farmId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=inventory-report.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// POST PDF export
router.post('/:farmId/inventory/export/pdf', authenticate, async (req, res, next) => {
  try {
    const { locationId } = req.body || {};
    const docDefinition = await generateInventoryPdf(req.params.farmId, { locationId });
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=inventory-report.pdf');
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) { next(err); }
});

// POST CSV export (per report type)
router.post('/:farmId/inventory/export/csv/:type', authenticate, async (req, res, next) => {
  try {
    const { type } = req.params;
    const validTypes = ['inventory', 'contracts', 'reconciliation', 'available'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }
    const csv = await generateInventoryCsv(req.params.farmId, type);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=inventory-${type}.csv`);
    res.send(csv);
  } catch (err) { next(err); }
});

export default router;
