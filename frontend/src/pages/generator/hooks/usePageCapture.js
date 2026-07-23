import { useRef } from 'react'

// Capturing each sign page's rendered Proposal — used for the combined payment link (clean
// product images), the version-history checkpoint (one image PER page, browsed as a carousel),
// and the multi-page PDF/PNG download. Every page's Proposal instance is kept in `pageRefs`,
// keyed by its stable part id, so these can pull from EVERY sign in page order.
export function usePageCapture(parts) {
  const pageRefs = useRef({})
  const proposalRef = useRef(null)   // LAST-page Proposal, for capturing the version snapshot image
  const multiPreviewRef = useRef(null)   // wraps all stacked pages — captured whole for the version image

  // Clean product image for EVERY sign, in page order (skips any that fail to render).
  const collectPartImages = async () => {
    const images = []
    for (const part of parts) {
      const pageHandle = pageRefs.current[part.__pid]
      if (pageHandle?.captureCleanImage) { try { images.push(await pageHandle.captureCleanImage()) } catch { /* skip a bad page */ } }
    }
    return images
  }

  // EVERY sign page's full snapshot, in page order, for the version-history checkpoint image.
  // Used to be stitched into one tall composite PNG (all pages stacked vertically) — unreadable
  // at a glance for a multi-sign quote, and the whole point of a version snapshot is seeing it
  // at first sight. Now returns the pages as a plain array; the History modal renders them as a
  // carousel (one page at a time, ‹ › between pages) instead of a scroll-forever stack.
  const captureAllPages = async () => {
    const snapshots = []
    for (const part of parts) {
      const pageHandle = pageRefs.current[part.__pid]
      if (pageHandle?.captureSnapshot) { try { snapshots.push(await pageHandle.captureSnapshot()) } catch { /* skip a bad page */ } }
    }
    return snapshots
  }

  // Every sign page at HD ({url,w,h}) for the multi-page download (PDF = one page each; PNG stitched).
  const capturePagesExport = async () => {
    const exports = []
    for (const part of parts) {
      const pageHandle = pageRefs.current[part.__pid]
      if (pageHandle?.captureExport) { try { exports.push(await pageHandle.captureExport()) } catch { /* skip */ } }
    }
    return exports
  }

  return { pageRefs, proposalRef, multiPreviewRef, collectPartImages, captureAllPages, capturePagesExport }
}
