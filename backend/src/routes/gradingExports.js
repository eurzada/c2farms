import { Router } from 'express';
import PdfPrinter from 'pdfmake';
import { authenticate } from '../middleware/auth.js';
import {
  generateGradingExcel, generateGradingPdf, generateGradingCsv,
} from '../services/gradingExportService.js';
import { getFontPaths } from '../utils/fontPaths.js';

const router = Router();

const printer = new PdfPrinter({ Roboto: getFontPaths() });

// POST Excel export
router.post('/:farmId/inventory/grading/export/excel', authenticate, async (req, res, next) => {
  try {
    const filters = req.body || {};
    const workbook = await generateGradingExcel(req.params.farmId, filters);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=grading-report.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// POST PDF export
router.post('/:farmId/inventory/grading/export/pdf', authenticate, async (req, res, next) => {
  try {
    const filters = req.body || {};
    const docDefinition = await generateGradingPdf(req.params.farmId, filters);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=grading-report.pdf');
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) { next(err); }
});

// POST CSV export
router.post('/:farmId/inventory/grading/export/csv', authenticate, async (req, res, next) => {
  try {
    const filters = req.body || {};
    const csv = await generateGradingCsv(req.params.farmId, filters);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=grading-report.csv');
    res.send(csv);
  } catch (err) { next(err); }
});

export default router;
