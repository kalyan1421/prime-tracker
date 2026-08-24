import { useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardBody, CardHeader, Button, Chip, addToast } from '@heroui/react';
import { FiArrowLeft, FiDownload, FiUpload, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';
import { useDownloadSaleImportTemplate, usePreviewSaleImport, useCommitSaleImport } from '../hooks/useApi';
import { errMsg, fmt, fmtDate } from '../utils/fmt';

/**
 * Bulk sale-history import (R5) — the sale-side counterpart of RentHistoryImportPage
 * (R1/R2). Same three-step shape: nothing is written until the preview is reviewed and
 * explicitly confirmed. See docs/client-discovery/HISTORICAL_DATA_SHEET_IMPORT_SPEC.md.
 */
export default function SaleHistoryImportPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = useDownloadSaleImportTemplate();
  const previewImport = usePreviewSaleImport();
  const commitImport = useCommitSaleImport();

  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);

  const handleFilePicked = async (file: File) => {
    if (!projectId) return;
    setFileName(file.name);
    setResult(null);
    try {
      const data = await previewImport.mutateAsync({ file, projectId });
      setPreview(data);
    } catch (e) {
      addToast({ title: errMsg(e, 'Could not read this file'), color: 'danger' });
      setPreview(null);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    const readyRows = preview.sales.filter((s: any) => s.status === 'ready').map((s: any) => s.data);
    if (readyRows.length === 0) return;
    try {
      const data = await commitImport.mutateAsync(readyRows);
      setResult(data);
      addToast({
        title: `Imported ${data.imported} sale${data.imported === 1 ? '' : 's'}${data.failed ? `, ${data.failed} failed` : ''}`,
        color: data.failed ? 'warning' : 'success',
      });
    } catch (e) {
      addToast({ title: errMsg(e, 'Import failed'), color: 'danger' });
    }
  };

  const startOver = () => {
    setPreview(null);
    setResult(null);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div>
        <Link
          to={projectId ? `/projects/${projectId}/revenue` : '/projects'}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-2"
        >
          <FiArrowLeft className="w-3.5 h-3.5" /> Back to project
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Import sale history</h1>
        <p className="text-sm text-gray-500 mt-1">
          Bulk-enter closed sales from a spreadsheet. Nothing is written until you review
          the preview below and confirm it. If a unit's past tenancy is also being
          imported, import the rent history first — a backfilled sale ends whatever
          tenancy it finds on record at the closing date.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-col items-start gap-1">
          <p className="font-semibold text-sm">1. Download the template</p>
          <p className="text-xs text-gray-500">
            Two tabs: Sales, and Commission Installments. Fill in Sales at minimum.
          </p>
        </CardHeader>
        <CardBody>
          <Button
            size="sm"
            variant="flat"
            startContent={<FiDownload />}
            isLoading={downloadTemplate.isPending}
            onPress={() => downloadTemplate.mutate()}
          >
            Download template (.xlsx)
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-col items-start gap-1">
          <p className="font-semibold text-sm">2. Upload your filled-in file</p>
          <p className="text-xs text-gray-500">Nothing is saved yet — this only parses and checks the file.</p>
        </CardHeader>
        <CardBody className="flex flex-row items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFilePicked(file);
            }}
          />
          <Button
            size="sm"
            color="primary"
            variant="flat"
            startContent={<FiUpload />}
            isLoading={previewImport.isPending}
            onPress={() => fileInputRef.current?.click()}
          >
            {fileName ? 'Choose a different file' : 'Choose file'}
          </Button>
          {fileName && <span className="text-xs text-gray-500">{fileName}</span>}
        </CardBody>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="flex flex-col items-start gap-1">
            <p className="font-semibold text-sm">3. Review before importing</p>
            <div className="flex gap-2 mt-1">
              <Chip size="sm" color="success" variant="flat">{preview.summary.ready} ready</Chip>
              {preview.summary.errors > 0 && (
                <Chip size="sm" color="danger" variant="flat">{preview.summary.errors} with errors</Chip>
              )}
              {preview.orphaned.length > 0 && (
                <Chip size="sm" color="warning" variant="flat">{preview.orphaned.length} unmatched commission row(s)</Chip>
              )}
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="px-2 py-1.5 font-semibold">Row</th>
                    <th className="px-2 py-1.5 font-semibold">Unit</th>
                    <th className="px-2 py-1.5 font-semibold">Buyer</th>
                    <th className="px-2 py-1.5 font-semibold">Closing Date</th>
                    <th className="px-2 py-1.5 font-semibold">Price</th>
                    <th className="px-2 py-1.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sales.map((s: any) => (
                    <tr key={s.rowNumber} className="border-b border-gray-50">
                      <td className="px-2 py-1.5 text-gray-400 tabular-nums">{s.rowNumber}</td>
                      <td className="px-2 py-1.5">{s.unitNumber || '—'}</td>
                      <td className="px-2 py-1.5">{s.buyer || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                        {s.data.closingDate ? fmtDate(s.data.closingDate) : '—'}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {s.data.salePrice != null ? fmt(s.data.salePrice) : '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        {s.status === 'ready' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <FiCheckCircle className="w-3.5 h-3.5" /> Ready
                          </span>
                        ) : (
                          <span className="inline-flex items-start gap-1 text-rose-700">
                            <FiAlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>{s.errors.join(' ')}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.orphaned.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800 mb-1">
                  These Commission Installments rows couldn't be matched to a Sales row:
                </p>
                <ul className="text-xs text-amber-700 space-y-0.5">
                  {preview.orphaned.map((o: any, i: number) => (
                    <li key={i}>{o.sheet} row {o.rowNumber} ({o.unitNumber} / {o.buyer}) — {o.error}</li>
                  ))}
                </ul>
              </div>
            )}

            {!result && (
              <div className="flex gap-2">
                <Button size="sm" variant="flat" onPress={startOver}>Start over</Button>
                <Button
                  size="sm"
                  color="primary"
                  isDisabled={preview.summary.ready === 0}
                  isLoading={commitImport.isPending}
                  onPress={handleCommit}
                >
                  Import {preview.summary.ready} ready row{preview.summary.ready === 1 ? '' : 's'}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader>
            <p className="font-semibold text-sm">Results</p>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <Chip size="sm" color="success" variant="flat">{result.imported} imported</Chip>
              {result.failed > 0 && <Chip size="sm" color="danger" variant="flat">{result.failed} failed</Chip>}
            </div>
            {result.failed > 0 && (
              <ul className="text-xs text-rose-700 space-y-0.5">
                {result.results.filter((r: any) => !r.success).map((r: any, i: number) => (
                  <li key={i}>{r.buyer} — {r.error}</li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="flat" onPress={startOver}>Import another file</Button>
              <Button size="sm" color="primary" onPress={() => navigate(`/projects/${projectId}/revenue`)}>
                Back to project
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
