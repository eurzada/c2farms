import { Router } from 'express';
import PdfPrinter from 'pdfmake';
import { authenticate } from '../middleware/auth.js';
import {
  generateLabourExcel, generateLabourPdf, generateLabourCsv,
} from '../services/labourExportService.js';
import { getFontPaths } from '../utils/fontPaths.js';

const router = Router();
const printer = new PdfPrinter({ Roboto: getFontPaths() });

// POST Excel export
router.post('/excel', authenticate, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || req.body.year) || new Date().getFullYear();
    const workbook = await generateLabourExcel(year);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="enterprise-labour-FY${year}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// POST PDF export
router.post('/pdf', authenticate, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || req.body.year) || new Date().getFullYear();
    const docDefinition = await generateLabourPdf(year);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="enterprise-labour-FY${year}.pdf"`);
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) { next(err); }
});

// POST CSV export
router.post('/csv', authenticate, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || req.body.year) || new Date().getFullYear();
    const csv = await generateLabourCsv(year);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="enterprise-labour-FY${year}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

export default router;
