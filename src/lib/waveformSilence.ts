/**
 * Waveform-based silence detection.
 *
 * SoundCloud serves precomputed waveform JSON (e.g. wave.sndcdn.com/xxx_m.json)
 * containing ~1800 peak sample values (0-140) spanning the entire track duration.
 * This lets us accurately detect dead silence (e.g. 30s or 60s copyright-bypass
 * intros and long trailing pauses) with 0ms audio lag and zero CPU decoding cost.
 */

interface WaveformData {
  width: number;
  height: number;
  samples: number[];
}

const waveformSilenceCache = new Map<string, { startSilenceSec: number; endSilenceSec: number }>();

/**
 * Fetches and analyzes SoundCloud's precomputed waveform JSON to detect
 * dead intro silences and trailing pauses.
 */
export async function detectSilenceFromWaveform(
  waveformUrl: string,
  durationSec: number
): Promise<{ startSilenceSec: number; endSilenceSec: number } | null> {
  if (!waveformUrl || durationSec <= 5) return null;

  if (waveformSilenceCache.has(waveformUrl)) {
    return waveformSilenceCache.get(waveformUrl)!;
  }

  try {
    const res = await fetch(waveformUrl);
    if (!res.ok) return null;
    const data: WaveformData = await res.json();
    if (!data.samples || data.samples.length === 0) return null;

    const samples = data.samples;
    const totalSamples = samples.length;
    const secPerSample = durationSec / totalSamples;

    // Detect initial dead silence (samples <= 2).
    // E.g. in "SENTINO - KOSMOS", first 445 samples are 0 (~59.13s silence).
    let startIdx = 0;
    while (startIdx < totalSamples && samples[startIdx] <= 2) {
      startIdx++;
    }
    const rawStartSilenceSec = startIdx > 0 ? Number((startIdx * secPerSample).toFixed(2)) : 0;

    // Detect trailing silence (samples <= 2 from end).
    let endIdx = totalSamples - 1;
    while (endIdx >= 0 && samples[endIdx] <= 2) {
      endIdx--;
    }
    const rawEndSilenceSec =
      endIdx < totalSamples - 1 ? Number(((endIdx + 1) * secPerSample).toFixed(2)) : durationSec;

    // We only trim start silence if it is at least 3.5 seconds long (dead air / copyright bypass),
    // avoiding clipping normal master pre-rolls (0.5s - 2.5s) or quiet acoustic/ambient openings.
    // We also leave a 0.3s safety pre-roll cushion so the first audio transient is never cut off.
    const hasSignificantStartSilence = rawStartSilenceSec >= 3.5;
    const effectiveStartSilence = hasSignificantStartSilence
      ? Math.max(0, Number((rawStartSilenceSec - 0.3).toFixed(2)))
      : 0;

    // We only trim trailing silence if it is at least 4.0 seconds long.
    // We leave a 1.0s safety reverb tail buffer so fade-outs and acoustic room decays aren't abruptly truncated.
    const trailingSilenceSec = durationSec - rawEndSilenceSec;
    const hasSignificantEndSilence = trailingSilenceSec >= 4.0;
    const effectiveEndSilence = hasSignificantEndSilence
      ? Math.min(durationSec, Number((rawEndSilenceSec + 1.0).toFixed(2)))
      : durationSec;

    const result = {
      startSilenceSec: effectiveStartSilence,
      endSilenceSec: effectiveEndSilence,
    };

    waveformSilenceCache.set(waveformUrl, result);
    return result;
  } catch {
    return null;
  }
}
