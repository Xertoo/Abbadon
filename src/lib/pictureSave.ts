/**
 * Helper to download and save artwork / profile pictures to disk (Pictures folder).
 */

export async function savePictureToDisk(
  url: string,
  title: string,
  notify?: (msg: string) => void
): Promise<boolean> {
  if (!url) {
    notify?.('No image available to save');
    return false;
  }

  // Upgrade SoundCloud image URL to high-resolution (500x500) if applicable
  let highResUrl = String(url).trim();
  if (highResUrl.includes('sndcdn.com')) {
    highResUrl = highResUrl.replace('-large.jpg', '-t500x500.jpg');
  }

  // 1. Electron Desktop IPC: saves directly to user's OS Pictures directory
  if (window.desktop?.savePicture) {
    try {
      const res = await window.desktop.savePicture({
        url: highResUrl,
        title,
      });

      if (res.ok) {
        notify?.(`Saved "${res.filename || title}" to Pictures`);
        return true;
      }
      throw new Error(res.error || 'Failed to save picture');
    } catch (err: any) {
      console.warn('[pictureSave] Desktop save error, falling back:', err);
    }
  }

  // 2. Web browser fallback download
  try {
    const cleanName = title.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'picture';
    const link = document.createElement('a');
    link.download = `${cleanName}.jpg`;

    if (highResUrl.startsWith('data:')) {
      link.href = highResUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      notify?.(`Saved "${cleanName}" to Pictures`);
      return true;
    }

    const resp = await fetch(highResUrl);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    link.href = blobUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    notify?.(`Saved "${cleanName}" to Pictures`);
    return true;
  } catch (err: any) {
    notify?.(`Failed to save image: ${err?.message || 'Error'}`);
    return false;
  }
}
