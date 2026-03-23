import { Router } from 'express';
import PdfPrinter from 'pdfmake';
import { authenticate } from '../middleware/auth.js';
import {
  generateProcurementExcel, generateProcurementPdf, generateProcurementCsv,
} from '../services/procurementExportService.js';
import { getFontPaths } from '../utils/fontPaths.js';

const router = Router();
const printer = new PdfPrinter({ Roboto: getFontPaths() });

// POST Excel export
router.post('/excel', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.query.year || req.body.year) || new Date().getFullYear();
    const workbook = await generateProcurementExcel(cropYear);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="procurement-report-${cropYear}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// POST PDF export
router.post('/pdf', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.query.year || req.body.year) || new Date().getFullYear();
    const docDefinition = await generateProcurementPdf(cropYear);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="procurement-report-${cropYear}.pdf"`);
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) { next(err); }
});

// POST CSV export
router.post('/csv', authenticate, async (req, res, next) => {
  try {
    const cropYear = parseInt(req.query.year || req.body.year) || new Date().getFullYear();
    const csv = await generateProcurementCsv(cropYear);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="procurement-report-${cropYear}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

export default router;
