import {
  suggestField, detectOrientation, detectPsfTotalSplit, splitPsfTotal, analyzeGrid, applyMapping, textToDateIso,
  parseDurationMonths, addMonthsIso, extractFirstEmail, extractFirstToken,
} from './xlsx-mapping';

describe('textToDateIso', () => {
  it('parses a clean date normally', () => {
    expect(textToDateIso('2021-11-18')).toBe('2021-11-18');
  });

  it('strips ordinal suffixes the real client sample uses throughout', () => {
    expect(textToDateIso('May 29th, 2026')).toBe('2026-05-29');
    expect(textToDateIso('January 23rd, 2026')).toBe('2026-01-23');
    expect(textToDateIso('September 1st ,2026')).toBe('2026-09-01');
  });

  it('tolerates a stray space before the comma and a trailing period', () => {
    expect(textToDateIso('October 2nd ,2025.')).toBe('2025-10-02');
  });

  it('returns undefined for genuinely unparseable text', () => {
    expect(textToDateIso('TBD')).toBeUndefined();
    expect(textToDateIso('')).toBeUndefined();
    expect(textToDateIso(undefined)).toBeUndefined();
  });
});

describe('parseDurationMonths (R9 field-gap audit — "Lease Term" as a duration string)', () => {
  it('parses years in the formats seen in the real client sample', () => {
    expect(parseDurationMonths('10years')).toBe(120);
    expect(parseDurationMonths('5 YEARS')).toBe(60);
    expect(parseDurationMonths('10 years')).toBe(120);
  });

  it('parses months', () => {
    expect(parseDurationMonths('18 months')).toBe(18);
    expect(parseDurationMonths('6mo')).toBe(6);
  });

  it('returns undefined for text with no recognizable duration', () => {
    expect(parseDurationMonths('2x5yr options')).toBeUndefined();
    expect(parseDurationMonths(undefined)).toBeUndefined();
  });
});

describe('addMonthsIso', () => {
  it('adds whole months and stays a calendar date, not a moment', () => {
    expect(addMonthsIso('2021-11-18', 120)).toBe('2031-11-18');
    expect(addMonthsIso('2024-01-31', 1)).toBe('2024-03-02'); // JS Date month-overflow — documented, not fixed up
  });
});

describe('extractFirstEmail / extractFirstToken (R9 field-gap audit — multi-value cells)', () => {
  it('takes the first email out of a newline-separated multi-value cell', () => {
    expect(extractFirstEmail('sharouqshahzad@gmail.com\nbhattridham@gmail.com\nkiratrph12@gmail.com'))
      .toBe('sharouqshahzad@gmail.com');
  });

  it('takes the first phone number out of a multi-value cell', () => {
    expect(extractFirstToken('(614)-886-0786\n972-816-3136')).toBe('(614)-886-0786');
  });

  it('returns undefined for a blank cell', () => {
    expect(extractFirstEmail(undefined)).toBeUndefined();
    expect(extractFirstToken('')).toBeUndefined();
  });
});

describe('suggestField', () => {
  it('matches an exact label', () => {
    expect(suggestField('Unit Number').field).toBe('unitNumber');
  });

  it('matches a known synonym from the real client sheet', () => {
    expect(suggestField('Unit no').field).toBe('unitNumber');
    expect(suggestField('Tenant').field).toBe('tenantName');
    expect(suggestField('Sqft').field).toBe('sqft');
    expect(suggestField('Leased Date').field).toBe('leaseStart');
  });

  it('leaves a header with no recognizable meaning unmapped', () => {
    expect(suggestField('Some Unrelated Column').field).toBeNull();
  });

  it('matches the landlord/owning-entity field added after the R9 field-gap audit', () => {
    expect(suggestField('LLC Name (Landlord)').field).toBe('landlordEntity');
  });

  it('matches the new email/phone/escalation/commission fields against the real client headers', () => {
    expect(suggestField('Email id').field).toBe('tenantEmail');
    expect(suggestField('Contact no').field).toBe('tenantPhone');
    expect(suggestField('Annual Increase').field).toBe('escalationPct');
    expect(suggestField('Lease Term').field).toBe('leaseTermMonths');
    expect(suggestField('1st Commission paid').field).toBe('commissionInstallment1');
    expect(suggestField('2nd Commission').field).toBe('commissionInstallment2');
  });

  it('does not let "TI Paid"/"TI Balance" (disbursement figures) suggest the agreed TI total', () => {
    // A real false positive found live: a bare 'ti' synonym matched both of these, and
    // acting on the suggestion would silently overwrite the agreed amount with what's
    // been paid so far — a financial correctness bug, not just an imperfect guess.
    expect(suggestField('TI Paid').field).toBeNull();
    expect(suggestField('TI Balance').field).toBeNull();
    expect(suggestField('TI Allowance').field).toBe('tiAllowance'); // still matches on its own
  });

  it('does not let a bare "sf" synonym substring-match inside "psf" columns', () => {
    // Another real false positive: 'sf' as a synonym for Sqft matched "TI(PSF/Total)"
    // because "psf" contains "sf" as a substring.
    expect(suggestField('TI(PSF/Total)').field).not.toBe('sqft');
    expect(suggestField('Sqft').field).toBe('sqft'); // the real header still matches
  });
});

describe('detectOrientation', () => {
  it('recognizes row-per-record when row 1 reads as field names', () => {
    const grid = [
      ['Unit no', 'Sft', 'Buyer', 'Purchase price'],
      ['300', '1200', 'Acme Corp', '450000'],
    ];
    expect(detectOrientation(grid)).toBe('rows');
  });

  it('recognizes a transposed sheet when column A reads as field names', () => {
    const grid = [
      ['', 'Unit 300', 'Unit 301'],
      ['Tenant', 'Acme Corp', 'Beta LLC'],
      ['Unit Number', '300', '301'],
      ['Sqft', '1200', '1400'],
    ];
    expect(detectOrientation(grid)).toBe('columns');
  });
});

describe('detectPsfTotalSplit / splitPsfTotal', () => {
  it('recognizes a majority of $PSF/$Total cells', () => {
    expect(detectPsfTotalSplit(['$12.50/$3200', '$14/$4100', ''])).toBe(true);
  });

  it('does not trigger on plain numbers', () => {
    expect(detectPsfTotalSplit(['3200', '4100'])).toBe(false);
  });

  it('splits into psf and total', () => {
    expect(splitPsfTotal('$12.50/$3,200')).toEqual({ psf: 12.5, total: 3200 });
  });

  it('returns nulls for a non-matching value', () => {
    expect(splitPsfTotal('3200')).toEqual({ psf: null, total: null });
  });
});

describe('analyzeGrid', () => {
  it('suggests fields per column for a row-per-record sheet', () => {
    const grid = [
      ['Unit no', 'Tenant', 'Sqft', 'Rent(PSF/Month)'],
      ['300', 'Acme Corp', '1200', '$2.50/$3000'],
      ['301', 'Beta LLC', '1400', '$2.60/$3640'],
    ];
    const result = analyzeGrid(grid);
    expect(result.orientation).toBe('rows');
    expect(result.supported).toBe(true);
    expect(result.recordCount).toBe(2);
    expect(result.fields[0].suggestedField).toBe('unitNumber');
    expect(result.fields[1].suggestedField).toBe('tenantName');
    expect(result.fields[3].splitSuggestion).toEqual({ type: 'psf_total', parts: ['rentPsf', 'monthlyRent'] });
  });

  it('suggests fields per row for a transposed sheet, one record per column', () => {
    const grid = [
      ['Project', 'RRC', 'RRC'],
      ['Tenant', 'Acme Corp', 'Beta LLC'],
      ['Unit Num', '300', '301'],
      ['Sqft', '1200', '1400'],
    ];
    const result = analyzeGrid(grid);
    expect(result.orientation).toBe('columns');
    expect(result.supported).toBe(true);
    expect(result.recordCount).toBe(2);
    // "Project" doesn't match any known field — offered unmapped, not dropped.
    expect(result.fields.find((f) => f.header === 'Project')?.suggestedField).toBeNull();
    expect(result.fields.find((f) => f.header === 'Tenant')?.suggestedField).toBe('tenantName');
    expect(result.fields.find((f) => f.header === 'Unit Num')?.suggestedField).toBe('unitNumber');
  });

  // R9 field-gap audit: NNN and TI columns matched the SAME "$X/$Y" pattern as rent,
  // so every combined-cell column got labeled "Split into Rent PSF + Monthly Rent" —
  // wrong for two of the three real columns that shape appears in on the client sheet.
  it('picks the split target pair from the column header, not just the value shape', () => {
    const grid = [
      ['Unit no', 'Rent(PSF/Month)', 'NNN', 'TI(PSF/Total)'],
      ['300', '$32/$8533.3', '$13/$3304.16', '$55/$167750'],
      ['301', '$34/$8641.66', '$13/$1954', '$45/$81000'],
    ];
    const result = analyzeGrid(grid);
    expect(result.fields[1].splitSuggestion).toEqual({ type: 'psf_total', parts: ['rentPsf', 'monthlyRent'] });
    expect(result.fields[2].splitSuggestion).toEqual({ type: 'psf_total', parts: ['nnnPsf', 'nnnTotalAmount'] });
    expect(result.fields[3].splitSuggestion).toEqual({ type: 'psf_total', parts: ['tiPsf', 'tiAllowance'] });
  });
});

describe('applyMapping', () => {
  it('builds field-keyed records from a confirmed column mapping', () => {
    const grid = [
      ['Unit no', 'Tenant', 'Sqft'],
      ['300', 'Acme Corp', '1200'],
      ['301', 'Beta LLC', '1400'],
    ];
    const mapping = {
      orientation: 'rows' as const,
      columns: [
        { columnIndex: 0, field: 'unitNumber' },
        { columnIndex: 1, field: 'tenantName' },
        { columnIndex: 2, field: 'sqft' },
      ],
    };
    const records = applyMapping(grid, mapping);
    expect(records).toEqual([
      { unitNumber: '300', tenantName: 'Acme Corp', sqft: '1200' },
      { unitNumber: '301', tenantName: 'Beta LLC', sqft: '1400' },
    ]);
  });

  it('splits a combined PSF/Total column into two target fields', () => {
    const grid = [
      ['Unit no', 'Rent(PSF/Month)'],
      ['300', '$2.50/$3000'],
    ];
    const mapping = {
      orientation: 'rows' as const,
      columns: [
        { columnIndex: 0, field: 'unitNumber' },
        { columnIndex: 1, field: 'rentPsf', splitPart: 'psf' as const },
        { columnIndex: 1, field: 'monthlyRent', splitPart: 'total' as const },
      ],
    };
    const records = applyMapping(grid, mapping);
    expect(records).toEqual([{ unitNumber: '300', rentPsf: '2.5', monthlyRent: '3000' }]);
  });

  it('skips blank data rows entirely', () => {
    const grid = [
      ['Unit no', 'Tenant'],
      ['300', 'Acme Corp'],
      ['', ''],
      ['301', 'Beta LLC'],
    ];
    const mapping = { orientation: 'rows' as const, columns: [{ columnIndex: 0, field: 'unitNumber' }, { columnIndex: 1, field: 'tenantName' }] };
    expect(applyMapping(grid, mapping)).toHaveLength(2);
  });

  describe('transposed sheets (field labels down column A, one record per column)', () => {
    it('builds one record per data column, keyed by row-mapped fields', () => {
      const grid = [
        ['Tenant', 'Acme Corp', 'Beta LLC'],
        ['Unit Num', '300', '301'],
        ['Sqft', '1200', '1400'],
      ];
      const mapping = {
        orientation: 'columns' as const,
        columns: [
          { columnIndex: 0, field: 'tenantName' },
          { columnIndex: 1, field: 'unitNumber' },
          { columnIndex: 2, field: 'sqft' },
        ],
      };
      const records = applyMapping(grid, mapping);
      expect(records).toEqual([
        { tenantName: 'Acme Corp', unitNumber: '300', sqft: '1200' },
        { tenantName: 'Beta LLC', unitNumber: '301', sqft: '1400' },
      ]);
    });

    it('splits a combined PSF/Total row across the same two target fields', () => {
      const grid = [
        ['Unit Num', '300'],
        ['Rent(PSF/Month)', '$2.50/$3000'],
      ];
      const mapping = {
        orientation: 'columns' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'rentPsf', splitPart: 'psf' as const },
          { columnIndex: 1, field: 'monthlyRent', splitPart: 'total' as const },
        ],
      };
      expect(applyMapping(grid, mapping)).toEqual([{ unitNumber: '300', rentPsf: '2.5', monthlyRent: '3000' }]);
    });

    it('skips a data column with nothing in any mapped row', () => {
      const grid = [
        ['Unit Num', '300', ''],
        ['Tenant', 'Acme Corp', ''],
      ];
      const mapping = {
        orientation: 'columns' as const,
        columns: [{ columnIndex: 0, field: 'unitNumber' }, { columnIndex: 1, field: 'tenantName' }],
      };
      expect(applyMapping(grid, mapping)).toHaveLength(1);
    });

    // Regression: a real live bug (2026-08-23) had the frontend send EVERY split
    // column's "total" half to the literal field 'monthlyRent', so a sheet with Rent,
    // NNN and TI all split in one mapping ended up with monthlyRent silently overwritten
    // by whichever split column came last — the client's real sheet has exactly this
    // shape. The frontend fix makes each column carry its OWN target pair; this pins the
    // backend's independent defense: the FIRST column to claim a target field wins, so
    // even a wrong mapping fails safe (drops the duplicate) instead of corrupting data.
    it('keeps the first value when two mapped columns are misconfigured to target the same field', () => {
      const grid = [
        ['Unit Num', 'Rent(PSF/Month)', 'TI(PSF/Total)'],
        ['300', '$2.50/$3000', '$5/$6000'],
      ];
      const mapping = {
        orientation: 'rows' as const,
        columns: [
          { columnIndex: 0, field: 'unitNumber' },
          { columnIndex: 1, field: 'rentPsf', splitPart: 'psf' as const },
          { columnIndex: 1, field: 'monthlyRent', splitPart: 'total' as const },
          // Misconfigured: TI's total should target tiAllowance, not monthlyRent.
          { columnIndex: 2, field: 'tiPsf', splitPart: 'psf' as const },
          { columnIndex: 2, field: 'monthlyRent', splitPart: 'total' as const },
        ],
      };
      expect(applyMapping(grid, mapping)).toEqual([{ unitNumber: '300', rentPsf: '2.5', monthlyRent: '3000', tiPsf: '5' }]);
    });
  });
});
