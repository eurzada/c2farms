import { Router } from 'express';
import { requireAnyFarmAdmin } from '../middleware/auth.js';
import { generateProductionYearReport } from '../services/auditReportService.js';
import { parseYear } from '../utils/fiscalYear.js';
import PdfPrinter from 'pdfmake';
import { getFontPaths } from '../utils/fontPaths.js';

const router = Router();
const printer = new PdfPrinter({ Roboto: getFontPaths() });

router.get('/audit-report', requireAnyFarmAdmin, async (req, res, next) => {
  try {
    const fiscalYear = parseYear(req.query.year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });

    const docDefinition = await generateProductionYearReport(fiscalYear);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=production-year-report-FY${fiscalYear}.pdf`);

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) {
    next(err);
  }
});

export default router;
