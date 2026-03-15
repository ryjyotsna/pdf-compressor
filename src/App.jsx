import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  compressPDF,
  formatFileSize,
  validatePDF,
  getPDFInfo,
  generateThumbnail,
  getHistory,
  addToHistory,
  clearHistory,
} from './utils/pdfCompressor';

const presetLevels = [
  { id: 'light', label: 'Light', quality: 0.85, scale: 2.0 },
  { id: 'balanced', label: 'Balanced', quality: 0.72, scale: 1.5 },
  { id: 'strong', label: 'Strong', quality: 0.55, scale: 1.2 },
];

const targetSizes = [
  { label: '10 MB', bytes: 10 * 1024 * 1024 },
  { label: '5 MB', bytes: 5 * 1024 * 1024 },
  { label: '2 MB', bytes: 2 * 1024 * 1024 },
  { label: '1 MB', bytes: 1 * 1024 * 1024 },
];

function App() {
  // File state (supports multiple files for batch)
  const [files, setFiles] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [fileInfos, setFileInfos] = useState({});
  const [thumbnails, setThumbnails] = useState({});

  // Settings
  const [preset, setPreset] = useState('balanced');
  const [customQuality, setCustomQuality] = useState(72);
  const [useCustomQuality, setUseCustomQuality] = useState(false);
  const [grayscale, setGrayscale] = useState(false);
  const [pageRange, setPageRange] = useState('');
  const [useTargetSize, setUseTargetSize] = useState(false);
  const [targetSize, setTargetSize] = useState(5 * 1024 * 1024);

  // UI state
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [history, setHistory] = useState([]);

  const fileInputRef = useRef(null);

  // Load history on mount
  useEffect(() => {
    setHistory(getHistory());
  }, []);

  // Generate thumbnails when files change
  useEffect(() => {
    files.forEach(async (file) => {
      const key = file.name + file.size; // unique key
      setFileInfos(prev => {
        if (prev[key]) return prev;
        getPDFInfo(file).then(info => {
          setFileInfos(p => ({ ...p, [key]: info }));
        });
        return prev;
      });
      setThumbnails(prev => {
        if (prev[key]) return prev;
        generateThumbnail(file).then(thumb => {
          setThumbnails(p => ({ ...p, [key]: thumb }));
        });
        return prev;
      });
    });
  }, [files]);

  const handleFileSelect = useCallback((selectedFiles) => {
    const validFiles = [];
    for (const file of selectedFiles) {
      const validation = validatePDF(file);
      if (validation.valid) {
        validFiles.push(file);
      }
    }
    if (validFiles.length === 0) {
      setError('Please select valid PDF files');
      return;
    }
    setFiles(validFiles);
    setError(null);
    setStatus('idle');
    setResults([]);
    setCurrentFileIndex(0);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) handleFileSelect(droppedFiles);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback((e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 0) handleFileSelect(selectedFiles);
  }, [handleFileSelect]);

  const handleCompress = async () => {
    if (files.length === 0) return;
    setStatus('compressing');
    setProgress(0);
    setError(null);
    setResults([]);

    const currentPreset = presetLevels.find(p => p.id === preset);
    const allResults = [];

    for (let i = 0; i < files.length; i++) {
      setCurrentFileIndex(i);
      const file = files[i];

      const options = {
        quality: useCustomQuality ? customQuality / 100 : currentPreset.quality,
        scale: currentPreset.scale,
        grayscale,
        pageRange,
        targetSize: useTargetSize ? targetSize : null,
      };

      const result = await compressPDF(file, options, (p) => {
        const overallProgress = ((i / files.length) + (p / 100 / files.length)) * 100;
        setProgress(Math.round(overallProgress));
      });

      if (result.success) {
        allResults.push({ ...result, originalName: file.name });
        addToHistory({
          filename: file.name,
          originalSize: result.originalSize,
          compressedSize: result.compressedSize,
          ratio: result.compressionRatio,
        });
      } else {
        allResults.push({ success: false, error: result.error, originalName: file.name });
      }
    }

    setResults(allResults);
    setHistory(getHistory());
    setStatus('success');
  };

  const handleDownload = (result) => {
    if (!result?.blob) return;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    results.filter(r => r.success).forEach(handleDownload);
  };

  const handleShare = async (result) => {
    if (!result?.blob || !navigator.share) return;
    try {
      const file = new File([result.blob], result.filename, { type: 'application/pdf' });
      await navigator.share({ files: [file], title: 'Compressed PDF' });
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Share failed:', e);
    }
  };

  const handleReset = () => {
    setFiles([]);
    setStatus('idle');
    setProgress(0);
    setResults([]);
    setError(null);
    setThumbnails({});
    setFileInfos({});
    setPageRange('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClearHistory = () => {
    clearHistory();
    setHistory([]);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const currentPreset = presetLevels.find(p => p.id === preset);
  const estimatedSize = files.length > 0
    ? files.reduce((sum, f) => sum + f.size, 0) * (1 - (useCustomQuality ? (customQuality / 100) * 0.6 : currentPreset.quality * 0.6))
    : null;

  const successResults = results.filter(r => r.success);

  // Check if Web Share API is available
  const canShare = (() => {
    try {
      return typeof navigator !== 'undefined' &&
             navigator.share &&
             navigator.canShare?.({ files: [new File([''], 'test.pdf', { type: 'application/pdf' })] });
    } catch {
      return false;
    }
  })();

  // Helper to get file key
  const getFileKey = (file) => file.name + file.size;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 pb-24">
      <div className="w-full max-w-xl">
        {/* Header */}
        <header className="mb-6 text-center">
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-extrabold tracking-tight"
            style={{ letterSpacing: '-0.02em' }}
          >
            SHRINK
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.05 }}
            className="text-base mt-1"
            style={{ color: 'var(--muted)' }}
          >
            Compress PDFs without losing clarity.
          </motion.p>
        </header>

        {/* Main Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-[20px] p-4"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow)',
          }}
        >
          <AnimatePresence mode="wait">
            {/* Upload State */}
            {status === 'idle' && files.length === 0 && (
              <motion.div
                key="upload"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className="rounded-[16px] p-12 text-center cursor-pointer transition-all duration-150"
                  style={{
                    border: isDragging ? '2px dashed rgba(255,255,255,.35)' : '2px dashed rgba(255,255,255,.12)',
                    background: isDragging ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.12)',
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    onChange={handleFileInput}
                    className="hidden"
                  />
                  <motion.div animate={{ scale: isDragging ? 1.02 : 1 }}>
                    <div className="text-base font-extrabold">Drop PDFs here</div>
                    <div className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
                      or click to browse (multiple supported)
                    </div>
                  </motion.div>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3 p-3 rounded-xl text-sm font-semibold"
                    style={{
                      background: 'rgba(255,120,120,.1)',
                      border: '1px solid rgba(255,120,120,.2)',
                      color: 'rgba(255,200,200,.95)',
                    }}
                  >
                    {error}
                  </motion.div>
                )}

                {/* History Toggle */}
                {history.length > 0 && (
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="w-full mt-4 py-2.5 text-sm font-bold rounded-xl transition-all"
                    style={{ color: 'var(--muted)' }}
                  >
                    {showHistory ? 'Hide History' : `Show History (${history.length})`}
                  </button>
                )}

                {/* History List */}
                <AnimatePresence>
                  {showHistory && history.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-3 space-y-2 overflow-hidden"
                    >
                      {history.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          className="p-3 rounded-xl text-sm"
                          style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)' }}
                        >
                          <div className="font-bold truncate">{item.filename}</div>
                          <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                            {formatFileSize(item.originalSize)} → {formatFileSize(item.compressedSize)} ({item.ratio}%)
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={handleClearHistory}
                        className="w-full py-2 text-sm font-bold rounded-xl"
                        style={{ color: 'rgba(255,120,120,.8)' }}
                      >
                        Clear History
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* Files Selected State */}
            {status === 'idle' && files.length > 0 && (
              <motion.div
                key="selected"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {/* File List with Thumbnails */}
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {files.map((file, idx) => (
                    <div
                      key={file.name + idx}
                      className="flex items-center gap-4 p-3 rounded-[14px]"
                      style={{ background: 'rgba(0,0,0,.12)', border: '1px solid var(--border)' }}
                    >
                      {/* Thumbnail */}
                      {thumbnails[getFileKey(file)] ? (
                        <img
                          src={thumbnails[getFileKey(file)]}
                          alt=""
                          className="w-12 h-14 object-cover rounded-lg"
                          style={{ border: '1px solid var(--border)' }}
                        />
                      ) : (
                        <div
                          className="w-12 h-14 rounded-lg flex items-center justify-center text-xs font-bold animate-pulse"
                          style={{ background: 'rgba(255,255,255,.05)', color: 'var(--muted)' }}
                        >
                          PDF
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold truncate">{file.name}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                          {formatFileSize(file.size)}
                          {fileInfos[getFileKey(file)]?.pageCount && ` · ${fileInfos[getFileKey(file)].pageCount} pages`}
                        </div>
                      </div>
                      <button
                        onClick={() => removeFile(idx)}
                        className="p-2 rounded-lg text-sm hover:bg-white/5 transition-colors"
                        style={{ color: 'var(--muted)' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add More Files */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-3 text-sm font-bold rounded-xl"
                  style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)' }}
                >
                  + Add more files
                </button>

                {/* Preset Selection */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold" style={{ color: 'var(--muted)' }}>Compression</span>
                    {estimatedSize && (
                      <motion.span
                        key={preset + customQuality}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-sm font-bold"
                        style={{ color: 'var(--muted)' }}
                      >
                        ~{formatFileSize(estimatedSize)}
                      </motion.span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {presetLevels.map((level) => (
                      <button
                        key={level.id}
                        onClick={() => { setPreset(level.id); setUseCustomQuality(false); }}
                        className="flex-1 py-3 px-3 rounded-xl text-sm font-bold transition-all duration-150"
                        style={{
                          background: preset === level.id && !useCustomQuality ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.03)',
                          border: preset === level.id && !useCustomQuality ? '1px solid rgba(255,255,255,.2)' : '1px solid var(--border)',
                        }}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Advanced Options Toggle */}
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full py-2.5 text-sm font-bold rounded-xl flex items-center justify-center gap-1"
                  style={{ color: 'var(--muted)' }}
                >
                  {showAdvanced ? '▲ Hide options' : '▼ More options'}
                </button>

                {/* Advanced Options */}
                <AnimatePresence>
                  {showAdvanced && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-4 overflow-hidden"
                    >
                      {/* Custom Quality Slider */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={useCustomQuality}
                              onChange={(e) => setUseCustomQuality(e.target.checked)}
                              className="w-4 h-4 rounded"
                            />
                            <span className="text-sm font-bold" style={{ color: 'var(--muted)' }}>Custom Quality</span>
                          </label>
                          <span className="text-sm font-bold" style={{ color: useCustomQuality ? 'var(--text)' : 'var(--muted)' }}>
                            {customQuality}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="30"
                          max="100"
                          value={customQuality}
                          onChange={(e) => { setCustomQuality(Number(e.target.value)); setUseCustomQuality(true); }}
                          disabled={!useCustomQuality}
                          className="w-full h-2 rounded-full appearance-none cursor-pointer"
                          style={{
                            background: `linear-gradient(to right, rgba(255,255,255,.4) ${customQuality - 30}%, rgba(255,255,255,.1) ${customQuality - 30}%)`,
                            opacity: useCustomQuality ? 1 : 0.4,
                          }}
                        />
                      </div>

                      {/* Grayscale */}
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={grayscale}
                          onChange={(e) => setGrayscale(e.target.checked)}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-sm font-bold" style={{ color: 'var(--muted)' }}>
                          Convert to Grayscale
                        </span>
                        <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,.1)', color: 'var(--muted)' }}>
                          Smaller
                        </span>
                      </label>

                      {/* Page Range */}
                      <div>
                        <div className="text-sm font-bold mb-2" style={{ color: 'var(--muted)' }}>
                          Page Range <span className="font-normal">(e.g., 1-5, 8, 12-15)</span>
                        </div>
                        <input
                          type="text"
                          value={pageRange}
                          onChange={(e) => setPageRange(e.target.value)}
                          placeholder="All pages"
                          className="w-full py-3 px-4 text-sm rounded-xl outline-none"
                          style={{
                            background: 'rgba(0,0,0,.2)',
                            border: '1px solid var(--border)',
                            color: 'var(--text)',
                          }}
                        />
                      </div>

                      {/* Target Size */}
                      <div>
                        <label className="flex items-center gap-3 mb-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={useTargetSize}
                            onChange={(e) => setUseTargetSize(e.target.checked)}
                            className="w-4 h-4 rounded"
                          />
                          <span className="text-sm font-bold" style={{ color: 'var(--muted)' }}>
                            Target Size
                          </span>
                        </label>
                        {useTargetSize && (
                          <div className="flex gap-2">
                            {targetSizes.map((size) => (
                              <button
                                key={size.bytes}
                                onClick={() => setTargetSize(size.bytes)}
                                className="flex-1 py-2.5 text-sm font-bold rounded-xl transition-all"
                                style={{
                                  background: targetSize === size.bytes ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.03)',
                                  border: targetSize === size.bytes ? '1px solid rgba(255,255,255,.2)' : '1px solid var(--border)',
                                }}
                              >
                                {size.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-xl text-sm font-semibold"
                    style={{
                      background: 'rgba(255,120,120,.1)',
                      border: '1px solid rgba(255,120,120,.2)',
                      color: 'rgba(255,200,200,.95)',
                    }}
                  >
                    {error}
                  </motion.div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 mt-1">
                  <button
                    onClick={handleReset}
                    className="py-3.5 px-5 rounded-xl text-sm font-bold"
                    style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)' }}
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleCompress}
                    className="flex-1 py-3.5 rounded-xl text-base font-extrabold transition-all duration-150 active:scale-[0.98]"
                    style={{
                      background: 'rgba(255,255,255,.92)',
                      color: 'rgba(10,10,12,.92)',
                      border: '1px solid rgba(255,255,255,.16)',
                    }}
                  >
                    Compress {files.length > 1 ? `${files.length} PDFs` : 'PDF'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Compressing State */}
            {status === 'compressing' && (
              <motion.div
                key="compressing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-10 text-center"
              >
                <div className="w-20 h-20 mx-auto mb-5 relative">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="6" />
                    <motion.circle
                      cx="50" cy="50" r="42" fill="none"
                      stroke="rgba(255,255,255,.85)" strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={264}
                      initial={{ strokeDashoffset: 264 }}
                      animate={{ strokeDashoffset: 264 - (264 * progress) / 100 }}
                      transition={{ duration: 0.2 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-base font-extrabold">{progress}%</span>
                  </div>
                </div>
                <div className="text-base font-bold">Compressing...</div>
                {files.length > 1 && (
                  <div className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
                    File {currentFileIndex + 1} of {files.length}
                  </div>
                )}
              </motion.div>
            )}

            {/* Success State */}
            {status === 'success' && results.length > 0 && (
              <motion.div
                key="success"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                {/* Results List */}
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {results.map((result, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-[14px]"
                      style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)' }}
                    >
                      {result.success ? (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-bold truncate flex-1 mr-3">{result.originalName}</span>
                            <span className="text-xs font-bold px-2 py-1 rounded-lg" style={{ background: 'rgba(100,255,100,.15)', color: 'rgba(150,255,150,.9)' }}>
                              -{result.compressionRatio}%
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs" style={{ color: 'var(--muted)' }}>
                              {formatFileSize(result.originalSize)} → {formatFileSize(result.compressedSize)}
                            </span>
                            <div className="flex gap-2">
                              {canShare && (
                                <button
                                  onClick={() => handleShare(result)}
                                  className="px-4 py-2 text-sm font-bold rounded-lg"
                                  style={{ background: 'rgba(255,255,255,.06)', border: '1px solid var(--border)' }}
                                >
                                  Share
                                </button>
                              )}
                              <button
                                onClick={() => handleDownload(result)}
                                className="px-4 py-2 text-sm font-bold rounded-lg"
                                style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)' }}
                              >
                                Download
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-sm" style={{ color: 'rgba(255,150,150,.9)' }}>
                          ✕ {result.originalName}: {result.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Summary Stats */}
                {successResults.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-3 rounded-[14px] text-center" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)' }}>
                      <div className="text-xs font-bold" style={{ color: 'var(--muted)' }}>Total Before</div>
                      <div className="text-sm font-extrabold mt-1">
                        {formatFileSize(successResults.reduce((s, r) => s + r.originalSize, 0))}
                      </div>
                    </div>
                    <div className="p-3 rounded-[14px] text-center" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)' }}>
                      <div className="text-xs font-bold" style={{ color: 'var(--muted)' }}>Total After</div>
                      <div className="text-sm font-extrabold mt-1">
                        {formatFileSize(successResults.reduce((s, r) => s + r.compressedSize, 0))}
                      </div>
                    </div>
                    <div className="p-3 rounded-[14px] text-center" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)' }}>
                      <div className="text-xs font-bold" style={{ color: 'var(--muted)' }}>Saved</div>
                      <div className="text-sm font-extrabold mt-1" style={{ color: 'rgba(150,255,150,.9)' }}>
                        {formatFileSize(successResults.reduce((s, r) => s + (r.originalSize - r.compressedSize), 0))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Download All */}
                {successResults.length > 1 && (
                  <button
                    onClick={handleDownloadAll}
                    className="w-full py-3.5 rounded-xl text-base font-extrabold transition-all duration-150 active:scale-[0.98]"
                    style={{
                      background: 'rgba(255,255,255,.92)',
                      color: 'rgba(10,10,12,.92)',
                      border: '1px solid rgba(255,255,255,.16)',
                    }}
                  >
                    Download All ({successResults.length})
                  </button>
                )}

                {/* Single Download */}
                {successResults.length === 1 && (
                  <button
                    onClick={() => handleDownload(successResults[0])}
                    className="w-full py-3.5 rounded-xl text-base font-extrabold transition-all duration-150 active:scale-[0.98]"
                    style={{
                      background: 'rgba(255,255,255,.92)',
                      color: 'rgba(10,10,12,.92)',
                      border: '1px solid rgba(255,255,255,.16)',
                    }}
                  >
                    Download
                  </button>
                )}

                {/* Compress Another */}
                <button
                  onClick={handleReset}
                  className="w-full py-3 rounded-xl text-sm font-bold"
                  style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)' }}
                >
                  Compress more files
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Privacy Note */}
        <p className="text-center text-xs mt-5 font-medium" style={{ color: 'var(--muted)' }}>
          Your files never leave your device.
        </p>
      </div>
      <a
        className="fixed bottom-5 left-1/2 -translate-x-1/2 text-sm px-4 py-2"
        >
        Coded by @jyotsna
      </a>
    </div>
  );
}

export default App;