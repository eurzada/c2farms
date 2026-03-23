import { Router } from 'express';
import PdfPrinter from 'pdfmake';
import { authenticate } from '../middleware/auth.js';
import {
  generateAgronomyExcel, generateAgronomyPdf, generateAgronomyCsv,
} from '../services/agronomyExportService.js';
import { getFontPaths } from '../utils/fontPaths.js';

const router = Router();

const printer = new PdfPrinter({ Roboto: getFontPaths() });

// POST Excel export
router.post('/:farmId/agronomy/export/excel', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.query.year || req.body.year) || new Date().getFullYear();
    const workbook = await generateAgronomyExcel(req.params.farmId, cropYear);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="crop-input-plan-${cropYear}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// POST PDF export
router.post('/:farmId/agronomy/export/pdf', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.query.year || req.body.year) || new Date().getFullYear();
    const docDefinition = await generateAgronomyPdf(req.params.farmId, cropYear);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="crop-input-plan-${cropYear}.pdf"`);
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) { next(err); }
});

// POST CSV export
router.post('/:farmId/agronomy/export/csv', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.query.year || req.body.year) || new Date().getFullYear();
    const csv = await generateAgronomyCsv(req.params.farmId, cropYear);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="crop-input-plan-${cropYear}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

export default router;
