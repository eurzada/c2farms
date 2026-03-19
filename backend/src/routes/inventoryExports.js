import { Router } from 'express';
import PdfPrinter from 'pdfmake';
import { authenticate } from '../middleware/auth.js';
import {
  generateInventoryExcel, generateInventoryPdf, generateInventoryCsv,
} from '../services/inventoryExportService.js';
import {
  generateCountHistoryExcel, generateCountHistoryPdf, generateCountHistoryCsv,
} from '../services/countHistoryExportService.js';
import { getFontPaths } from '../utils/fontPaths.js';

const router = Router();

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

// ─── Count History Matrix Exports ─────────────────────────────────────

router.get('/:farmId/inventory/count-history/export/excel', authenticate, async (req, res, next) => {
  try {
    const workbook = await generateCountHistoryExcel(req.params.farmId, req.query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="count-history-${new Date().toISOString().slice(0,10)}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

router.get('/:farmId/inventory/count-history/export/pdf', authenticate, async (req, res, next) => {
  try {
    const docDef = await generateCountHistoryPdf(req.params.farmId, req.query);
    const pdfDoc = printer.createPdfKitDocument(docDef);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="count-history-${new Date().toISOString().slice(0,10)}.pdf"`);
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) { next(err); }
});

router.get('/:farmId/inventory/count-history/export/csv', authenticate, async (req, res, next) => {
  try {
    const csv = await generateCountHistoryCsv(req.params.farmId, req.query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="count-history-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

export default router;
