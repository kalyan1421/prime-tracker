/**
 * Invoice files on fit-out bills (client, 2026-11-11: "invoices can be uploaded to the
 * linked purchase order").
 *
 * A bill already belongs to its PO, so an invoice file is a Document attached to the BILL
 * (`interiorInvoiceId`). These tests pin the three ways in: the add-bill form's file field,
 * "Attach invoice" on an existing bill, and adding a bill from the purchase-order row without
 * leaving the Purchase orders tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { InteriorBillsPanel, InteriorPurchaseOrdersPanel } from './InteriorPurchasingPanels';

const uploads: FormData[] = [];
const added: any[] = [];
const state = {
  docs: [] as any[],
  uploadFails: false,
};

vi.mock('../hooks/useApi', () => ({
  useAddInteriorInvoice: () => ({
    mutateAsync: (payload: any) => { added.push(payload); return Promise.resolve({ id: 'bill-new' }); },
    isPending: false,
  }),
  useUploadDocument: () => ({
    mutateAsync: (fd: FormData) => {
      uploads.push(fd);
      return state.uploadFails ? Promise.reject(new Error('Upload refused')) : Promise.resolve({ id: 'doc-new' });
    },
    isPending: false,
  }),
  useInteriorDocuments: () => ({ data: state.docs, isLoading: false }),
  useUpdateInteriorInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVoidInteriorInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInteriorCostingSettings: () => ({ data: undefined }),
  useInteriorPurchaseOrderAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInteriorCostCodes: () => ({ data: [] }),
  useCreateInteriorChangeOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDecideInteriorChangeOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateInteriorPurchaseOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVendors: () => ({ data: [] }),
}) as any);

const toasts: any[] = [];
vi.mock('@heroui/react', async (orig) => ({
  ...(await orig<typeof import('@heroui/react')>()),
  addToast: (t: any) => { toasts.push(t); },
}));

function costing(can: Record<string, boolean> = {}) {
  return {
    id: 'ip1',
    estimateStatus: 'LOCKED',
    can: { seeMoney: true, addBill: true, createPurchaseOrder: true, ...can },
    purchaseOrders: [{
      id: 'po1', number: 'FIT-0001', title: 'Rooftop units', status: 'APPROVED', variance: false, materialsOnly: false,
      cost: 180000, billed: 60000, paid: 60000, vendor: { name: 'Bluesky Mechanical' }, lines: [], workCompletedAt: null,
    }],
    bills: [{
      id: 'bill-1', invoiceNo: 'BSM-1042', purchaseOrderId: 'po1', purchaseOrderNumber: 'FIT-0001',
      amount: 60000, status: 'PAID', vendor: { name: 'Bluesky Mechanical' }, invoiceDate: '2026-10-16',
    }],
  };
}

const invoiceDoc = {
  id: 'd-inv', category: 'INVOICE', interiorInvoiceId: 'bill-1', fileName: 'BSM-1042.pdf', fileUrl: 'https://s3/signed/inv.pdf',
};
const pdf = () => new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' });

beforeEach(() => {
  uploads.length = 0;
  added.length = 0;
  toasts.length = 0;
  state.docs = [];
  state.uploadFails = false;
});

describe('Bills tab', () => {
  it('links each bill to its invoice file', () => {
    state.docs = [invoiceDoc, { id: 'd-draw', category: 'DRAWING', fileName: 'plan.pdf', fileUrl: 'x' }];
    render(<InteriorBillsPanel costing={costing()} />);

    const link = screen.getByRole('link', { name: /BSM-1042\.pdf/ });
    expect(link.getAttribute('href')).toBe('https://s3/signed/inv.pdf');
    // Only INVOICE documents attached to a bill show up against it.
    expect(screen.queryByText('plan.pdf')).toBeNull();
  });

  it('attaches a file to an existing bill as its invoice', async () => {
    render(<InteriorBillsPanel costing={costing()} />);

    fireEvent.change(screen.getByLabelText('Invoice file for bill bill-1'), { target: { files: [pdf()] } });

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].get('interiorInvoiceId')).toBe('bill-1');
    expect(uploads[0].get('interiorProjectId')).toBe('ip1');
    expect((uploads[0].get('file') as File).name).toBe('invoice.pdf');
  });

  it('offers no attach control to someone who cannot add bills', () => {
    render(<InteriorBillsPanel costing={costing({ addBill: false })} />);
    expect(screen.queryByText('Attach invoice')).toBeNull();
    expect(screen.getByText('No file')).toBeTruthy();
  });

  it('adds the bill, then uploads the chosen invoice file against the new bill', async () => {
    render(<InteriorBillsPanel costing={costing()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add bill/ }));

    fireEvent.change(screen.getByLabelText('Bill amount'), { target: { value: '25000' } });
    fireEvent.change(screen.getByLabelText('Invoice file'), { target: { files: [pdf()] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add bill' }).at(-1)!);

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(added[0]).toMatchObject({ id: 'ip1', data: { purchaseOrderId: 'po1', amount: 25000 } });
    // The file goes on the bill the API just created — never on a guessed or preset id.
    expect(uploads[0].get('interiorInvoiceId')).toBe('bill-new');
    expect(toasts.at(-1)).toMatchObject({ title: 'Bill added with its invoice', color: 'success' });
  });

  it('says the bill stands when only the file fails, and where to retry', async () => {
    state.uploadFails = true;
    render(<InteriorBillsPanel costing={costing()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add bill/ }));
    fireEvent.change(screen.getByLabelText('Bill amount'), { target: { value: '25000' } });
    fireEvent.change(screen.getByLabelText('Invoice file'), { target: { files: [pdf()] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add bill' }).at(-1)!);

    await waitFor(() => expect(toasts.at(-1)?.color).toBe('warning'));
    expect(toasts.at(-1).title).toMatch(/Bill added, but the invoice file did not upload/);
    expect(toasts.at(-1).title).toMatch(/Attach invoice/);
  });

  it('adds a bill with no file without trying to upload', async () => {
    render(<InteriorBillsPanel costing={costing()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add bill/ }));
    fireEvent.change(screen.getByLabelText('Bill amount'), { target: { value: '100' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add bill' }).at(-1)!);

    await waitFor(() => expect(added).toHaveLength(1));
    expect(uploads).toHaveLength(0);
    expect(toasts.at(-1)).toMatchObject({ title: 'Bill added' });
  });
});

describe('Purchase orders tab', () => {
  it('flags a PO that has invoice files, and lists them under its bills', () => {
    state.docs = [invoiceDoc];
    render(<InteriorPurchaseOrdersPanel costing={costing()} />);

    expect(screen.getByText('1 invoice')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /FIT-0001/ }));
    expect(screen.getByText(/Bills & invoices/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /BSM-1042\.pdf/ })).toBeTruthy();
  });

  it('adds a bill with its invoice from the PO itself, without leaving the tab', async () => {
    render(<InteriorPurchaseOrdersPanel costing={costing()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Bill' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Add a bill to FIT-0001')).toBeTruthy();
    // Preset to this PO.
    expect((within(dialog).getByLabelText('Purchase order') as HTMLSelectElement).value).toBe('po1');

    fireEvent.change(within(dialog).getByLabelText('Bill amount'), { target: { value: '5000' } });
    fireEvent.change(within(dialog).getByLabelText('Invoice file'), { target: { files: [pdf()] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add bill' }));

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(added[0].data.purchaseOrderId).toBe('po1');
    expect(uploads[0].get('interiorInvoiceId')).toBe('bill-new');
  });

  it('shows Construction no bills and no invoice files', () => {
    state.docs = [invoiceDoc];
    render(<InteriorPurchaseOrdersPanel costing={{ ...costing({ seeMoney: false, addBill: false }), bills: [] }} />);
    expect(screen.queryByText(/invoice/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bill' })).toBeNull();
  });
});
