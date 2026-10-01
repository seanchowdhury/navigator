import { domToBlob } from "modern-screenshot";

/** Put this attribute on elements (buttons, hints) to leave them out of the image. */
export const EXCLUDE_FROM_IMAGE = "data-exclude-from-image";

// Safari can leave images and web fonts blank in the first capture of a page;
// a throwaway capture first loads them.
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

/**
 * Renders `node` (including any WebGL canvas in it, which must be created with
 * preserveDrawingBuffer) to a PNG file at the screen's pixel density.
 */
export async function captureImage(node: HTMLElement, fileName: string): Promise<File> {
  const options = {
    scale: Math.min(window.devicePixelRatio || 1, 3),
    type: "image/png",
    filter: (el: Node) => !(el instanceof Element && el.hasAttribute(EXCLUDE_FROM_IMAGE)),
  };
  if (isSafari) await domToBlob(node, options);
  const blob = await domToBlob(node, options);
  return new File([blob], fileName, { type: "image/png" });
}

/** Whether the system share sheet can take this file (not desktop Firefox or Linux). */
export function canShareFile(file: File) {
  return typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
}

/**
 * Opens the share sheet with `file`, falling back to a download if sharing is
 * refused. Must be called straight from a tap: browsers (iOS especially) only
 * allow sharing in direct response to one, so the file has to be ready already.
 */
export async function shareFile(file: File, title: string) {
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // closed the sheet
    }
  }
  downloadFile(file);
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
