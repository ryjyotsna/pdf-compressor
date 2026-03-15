import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

/**
 * Parse page range string like "1-5, 8, 12-15" into array of page numbers
 */
export function parsePageRange(rangeStr, totalPages) {
  if (!rangeStr || rangeStr.trim() === '') {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set();
  const parts = rangeStr.split(',').map(s => s.trim());

  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n.trim(), 10));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(totalPages, end); i++) {
          pages.add(i);
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= totalPages) {
        pages.add(num);
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * Get PDF page count without fully loading
 */
export async function getPDFInfo(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;
    return {
      pageCount: pdfDoc.numPages,
      size: file.size,
    };
  } catch (error) {
    return { pageCount: 0, size: file.size, error: error.message };
  }
}

/**
 * Generate thumbnail of first page
 */
export async function generateThumbnail(file, pageNum = 1) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;

    if (pageNum > pdfDoc.numPages) pageNum = 1;

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.5 });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (error) {
    console.error('Thumbnail generation failed:', error);
    return null;
  }
}

/**
 * Convert canvas to grayscale
 */
function applyGrayscale(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }

  context.putImageData(imageData, 0, 0);
}

/**
 * Main compression function with advanced options
 */
export async function compressPDF(file, options = {}, onProgress) {
  const {
    quality = 0.72,
    scale = 1.5,
    grayscale: useGrayscale = false,
    pageRange = '',
    targetSize = null, // in bytes, null means no target
  } = options;

  try {
    onProgress?.(5);

    const arrayBuffer = await file.arrayBuffer();
    const originalSize = arrayBuffer.byteLength;

    onProgress?.(10);

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    const pagesToProcess = parsePageRange(pageRange, numPages);

    onProgress?.(15);

    // If target size is set, we may need to iterate
    let currentQuality = quality;
    let currentScale = scale;
    let attempts = 0;
    const maxAttempts = targetSize ? 5 : 1;

    let compressedBlob = null;
    let compressedSize = 0;

    while (attempts < maxAttempts) {
      const pageImages = [];

      for (let idx = 0; idx < pagesToProcess.length; idx++) {
        const pageNum = pagesToProcess[idx];
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: currentScale });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // White background
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;

        // Apply grayscale if enabled
        if (useGrayscale) {
          applyGrayscale(context, canvas.width, canvas.height);
        }

        const blob = await new Promise((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', currentQuality);
        });

        const imageBytes = await blob.arrayBuffer();
        pageImages.push({
          bytes: new Uint8Array(imageBytes),
          width: viewport.width,
          height: viewport.height,
          originalPageNum: pageNum,
        });

        const renderProgress = 15 + ((idx / pagesToProcess.length) * 55);
        onProgress?.(Math.round(renderProgress));
      }

      onProgress?.(75);

      // Create new PDF
      const newPdfDoc = await PDFDocument.create();

      for (const pageImage of pageImages) {
        const jpgImage = await newPdfDoc.embedJpg(pageImage.bytes);
        const pageWidth = pageImage.width / currentScale;
        const pageHeight = pageImage.height / currentScale;

        const page = newPdfDoc.addPage([pageWidth, pageHeight]);
        page.drawImage(jpgImage, {
          x: 0,
          y: 0,
          width: pageWidth,
          height: pageHeight,
        });
      }

      onProgress?.(85);

      const compressedBytes = await newPdfDoc.save({
        useObjectStreams: true,
      });

      compressedSize = compressedBytes.byteLength;
      compressedBlob = new Blob([compressedBytes], { type: 'application/pdf' });

      // Check if we hit target size
      if (!targetSize || compressedSize <= targetSize) {
        break;
      }

      // Reduce quality/scale for next attempt
      currentQuality = Math.max(0.3, currentQuality - 0.15);
      currentScale = Math.max(0.8, currentScale - 0.2);
      attempts++;

      onProgress?.(15); // Reset progress for retry
    }
