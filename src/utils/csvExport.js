import Papa from 'papaparse';

export function exportCSV(leads) {
  const rows = leads.map(lead => {
    const base = { ...lead.raw };
    base['Signal_Found']          = lead.signal?.signal_found ? 'Yes' : 'No';
    base['Signal_Type']           = lead.signal?.signal_type  || '';
    base['Signal_Date']           = lead.signal?.signal_date  || '';
    base['Signal_Source']         = lead.signal?.signal_source || '';
    base['Personalized_First_Line'] = lead.firstLine || '';
    base['Full_Email']            = lead.fullEmail  || '';
    return base;
  });

  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `cold-emails-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
