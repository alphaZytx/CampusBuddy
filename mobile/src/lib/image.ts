import { parseUpiUri, type UpiPaymentTarget } from '@campusbuddy/shared';

/**
 * In-browser image preparation for profile photos and payment QR codes.
 *
 * Everything is redrawn through a canvas before upload. That does three useful
 * things at once: it bakes the phone's rotation into the pixels, it shrinks a
 * multi-megabyte camera photo to a few dozen kilobytes, and it drops every piece of
 * metadata — including the GPS position a phone embeds in each photo.
 */

export class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const AVATAR_SIZE = 512;
const AVATAR_MIN_SIDE = 64;
/** QR detection runs on a copy no larger than this, which keeps it fast on phones. */
const QR_SCAN_MAX = 1024;
const QR_OUTPUT_MIN = 360;
const QR_OUTPUT_MAX = 800;
/** White border kept around a cropped code, as a fraction of its width. Scanners need it. */
const QR_QUIET_ZONE = 0.12;

function assertImageFile(file: File): void {
  const looksLikeImage =
    file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name);
  if (!looksLikeImage) throw new ImageProcessingError('Choose an image file, such as a JPG or PNG.');
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageProcessingError('That image is larger than 25 MB. Choose a smaller one.');
  }
}

/** Decodes the file and hands the image to `work`, releasing the object URL afterwards. */
async function withDecodedImage<T>(file: File, work: (image: HTMLImageElement) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new ImageProcessingError("This browser can't open that image. Choose a JPG or PNG instead.");
    }
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new ImageProcessingError("That image appears to be empty. Choose a different one.");
    }
    return await work(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function createCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new ImageProcessingError('Your browser could not process the image. Try another browser.');
  // A white base, so transparent PNGs do not turn black when saved as JPEG and a
  // transparent QR code stays scannable.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageProcessingError('Could not process that image.'))),
      type,
      quality,
    );
  });
}

// --- Profile photo ------------------------------------------------------------

/** A square, centre-cropped JPEG of at most 512×512. */
export async function prepareAvatar(file: File): Promise<Blob> {
  assertImageFile(file);
  return withDecodedImage(file, async (image) => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const side = Math.min(width, height);
    if (side < AVATAR_MIN_SIDE) {
      throw new ImageProcessingError('That photo is too small. Choose one at least 64 pixels across.');
    }

    const size = Math.min(AVATAR_SIZE, side);
    const { canvas, context } = createCanvas(size, size);
    context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
    return canvasToBlob(canvas, 'image/jpeg', 0.88);
  });
}

// --- Payment QR code ----------------------------------------------------------

export interface PreparedUpiQr {
  /** A clean PNG of the code, ready to upload. */
  blob: Blob;
  /** Who the code actually pays, read from the code itself. */
  target: UpiPaymentTarget;
  /** True when the image was cropped down to just the code. */
  cropped: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface CropBox {
  x: number;
  y: number;
  side: number;
}

/** The square around a code's four corners, plus a quiet-zone margin, in image pixels. */
export function qrCropBox(corners: readonly Point[], margin: number = QR_QUIET_ZONE): CropBox {
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const codeSide = Math.max(maxX - minX, maxY - minY);
  const side = codeSide * (1 + 2 * margin);
  return { x: (minX + maxX) / 2 - side / 2, y: (minY + maxY) / 2 - side / 2, side };
}

type JsQr = typeof import('jsqr').default;

/**
 * Loads the QR decoder on demand, so it is only downloaded by someone actually
 * adding a QR code. The package is a UMD bundle, so its default export can arrive
 * either directly or wrapped, depending on the bundler.
 */
async function loadJsQr(): Promise<JsQr> {
  const loaded = (await import('jsqr')) as unknown as { default: JsQr | { default: JsQr } };
  const candidate = loaded.default;
  return typeof candidate === 'function' ? candidate : candidate.default;
}

function readQr(jsQR: JsQr, context: CanvasRenderingContext2D, width: number, height: number) {
  const { data } = context.getImageData(0, 0, width, height);
  // Some UPI apps show light-on-dark codes; try both polarities.
  return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
}

/** Draws `box` from the image into a square canvas, filling anything outside the image with white. */
function drawCrop(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  box: CropBox,
  outSize: number,
): void {
  const scale = outSize / box.side;
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(image.naturalWidth, box.x + box.side);
  const y1 = Math.min(image.naturalHeight, box.y + box.side);
  if (x1 <= x0 || y1 <= y0) return;
  context.drawImage(
    image,
    x0,
    y0,
    x1 - x0,
    y1 - y0,
    (x0 - box.x) * scale,
    (y0 - box.y) * scale,
    (x1 - x0) * scale,
    (y1 - y0) * scale,
  );
}

/**
 * Checks that an image really contains a UPI payment code, then crops it to just
 * the code so the payer sees a clean, large QR rather than a whole phone screenshot.
 *
 * The crop is only used if it still decodes to exactly the same payment link;
 * otherwise the whole (downscaled) image is kept, so cropping can never make a
 * working code unreadable.
 */
export async function prepareUpiQr(file: File): Promise<PreparedUpiQr> {
  assertImageFile(file);
  const jsQR = await loadJsQr();

  return withDecodedImage(file, async (image) => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;

    // 1. Find the code on a working copy.
    const scale = Math.min(1, QR_SCAN_MAX / Math.max(width, height));
    const scanWidth = Math.max(1, Math.round(width * scale));
    const scanHeight = Math.max(1, Math.round(height * scale));
    const scan = createCanvas(scanWidth, scanHeight);
    scan.context.drawImage(image, 0, 0, scanWidth, scanHeight);

    const code = readQr(jsQR, scan.context, scanWidth, scanHeight);
    if (!code) {
      throw new ImageProcessingError(
        "We couldn't find a QR code in that image. Upload the QR your UPI app shows for receiving money, or a clear screenshot of it.",
      );
    }
    const target = parseUpiUri(code.data);
    if (!target) {
      throw new ImageProcessingError(
        "That QR code isn't a UPI payment code. Use the one your UPI app shows for receiving money.",
      );
    }

    // 2. Crop to the code plus a quiet zone, from the full-resolution original.
    const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = code.location;
    const box = qrCropBox(
      [topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner].map((point) => ({
        x: point.x / scale,
        y: point.y / scale,
      })),
    );
    const outSize = Math.round(Math.min(QR_OUTPUT_MAX, Math.max(QR_OUTPUT_MIN, box.side)));
    const output = createCanvas(outSize, outSize);
    // Keep the square modules crisp when a small code is enlarged.
    output.context.imageSmoothingEnabled = outSize < box.side;
    drawCrop(output.context, image, box, outSize);

    // 3. Only keep the crop if it still reads as the very same payment link.
    const check = readQr(jsQR, output.context, outSize, outSize);
    const cropped = check?.data === code.data;
    const blob = await canvasToBlob(cropped ? output.canvas : scan.canvas, 'image/png');
    return { blob, target, cropped };
  });
}
