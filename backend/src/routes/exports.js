import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { generateExcel, generatePdf } from '../services/exportService.js';
import { parseYear } from '../utils/fiscalYear.js';
import PdfPrinter from 'pdfmake';
import { getFontPaths } from '../utils/fontPaths.js';

const router = Router();

const printer = new PdfPrinter({ Roboto: getFontPaths() });

router.post('/:farmId/export/excel/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });
    const workbook = await generateExcel(farmId, fiscalYear);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=operating-statement-${year}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

router.post('/:farmId/export/pdf/:year', authenticate, async (req, res, next) => {
  try {
    const { farmId, year } = req.params;
    const fiscalYear = parseYear(year);
    if (!fiscalYear) return res.status(400).json({ error: 'Invalid fiscal year' });
    const docDefinition = await generatePdf(farmId, fiscalYear);

    const pdfDoc = printer.createPdfKitDocument(docDefinition);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=operating-statement-${year}.pdf`);

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) {
    next(err);
  }
});

export default router;
