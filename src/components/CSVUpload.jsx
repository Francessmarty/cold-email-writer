import { useState, useRef } from 'react';
import { parseCSV } from '../utils/csvParser';

export default function CSVUpload({ onUploadComplete }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      setError('Please upload a .csv file.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await parseCSV(file);
      if (result.rows.length === 0) {
        setError('The CSV file is empty.');
        setLoading(false);
        return;
      }
      onUploadComplete(result, file.name);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }

  function onInputChange(e) {
    handleFile(e.target.files[0]);
    // Reset so same file can be re-uploaded
    e.target.value = '';
  }

  return (
    <div className="upload-wrapper">
      <div
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={onInputChange}
        />
        <div className="drop-icon">📄</div>
        <p className="drop-label">Drop your CSV here or <span className="link">browse</span></p>
        <p className="drop-hint">Needs columns for LinkedIn URL and company website</p>
      </div>
      {loading && <p className="status-msg">Parsing CSV...</p>}
      {error && <p className="error-msg">{error}</p>}
    </div>
  );
}
