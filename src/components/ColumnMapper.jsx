// Lets the user confirm or correct the auto-detected column mapping
export default function ColumnMapper({ headers, linkedinCol, websiteCol, onConfirm }) {
  return (
    <div className="mapper-wrapper">
      <h2>Confirm column mapping</h2>
      <p className="mapper-hint">
        We auto-detected the columns below. Adjust if needed, then confirm.
      </p>

      <form
        className="mapper-form"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          onConfirm({
            linkedinCol: fd.get('linkedin'),
            websiteCol: fd.get('website'),
          });
        }}
      >
        <div className="mapper-row">
          <label htmlFor="linkedin-select">LinkedIn URL column</label>
          <select id="linkedin-select" name="linkedin" defaultValue={linkedinCol || ''}>
            <option value="">(not found)</option>
            {headers.map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>

        <div className="mapper-row">
          <label htmlFor="website-select">Company website column</label>
          <select id="website-select" name="website" defaultValue={websiteCol || ''}>
            <option value="">(not found)</option>
            {headers.map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn-primary">Confirm and load leads</button>
      </form>
    </div>
  );
}
