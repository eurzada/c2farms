import { Router } from 'express';
import { requireAnyFarmAdmin } from '../middleware/auth.js';
import { generateProductionYearReport } from '../services/auditReportService.js';
import { generateCustomReport } from '../services/reportingService.js';
import { parseYear } from '../utils/fiscalYear.js';
import PdfPrinter from 'pdfmake';
import { getFontPaths } from '../utils/fontPaths.js';

const router = Router();
const printer = new PdfPrinter({ Roboto: getFontPaths() });

// Canned: Production Year Report (same as audit-report endpoint)
router.get('/reporting/production-year', requireAnyFarmAdmin, async (req, res, next) => {
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

// Custom Report Builder
router.post('/reporting/custom', requireAnyFarmAdmin, async (req, res, next) => {
  try {
    const { fiscalYear, farmIds, sections, format } = req.body;

    if (!fiscalYear || !Array.isArray(farmIds) || !Array.isArray(sections) || !format) {
      return res.status(400).json({ error: 'Missing required fields: fiscalYear, farmIds, sections, format' });
    }

    if (!['pdf', 'excel', 'csv'].includes(format)) {
      return res.status(400).json({ error: 'Format must be pdf, excel, or csv' });
    }

    if (sections.length === 0) {
      return res.status(400).json({ error: 'At least one section must be selected' });
    }

    const result = await generateCustomReport({ fiscalYear, farmIds, sections, format });

    if (result.format === 'pdf') {
      const pdfDoc = printer.createPdfKitDocument(result.docDefinition);
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename=${result.filename}`);
      pdfDoc.pipe(res);
      pdfDoc.end();
    } else if (result.format === 'excel') {
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename=${result.filename}`);
      await result.workbook.xlsx.write(res);
      res.end();
    } else {
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename=${result.filename}`);
      res.send(result.csvString);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
