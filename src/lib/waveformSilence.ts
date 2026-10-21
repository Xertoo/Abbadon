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

    // Detect initial silence (samples <= 2).
    // E.g. in "SENTINO - KOSMOS", first 445 samples are 0 (~59.13s silence).
    let startIdx = 0;
    while (startIdx < totalSamples && samples[startIdx] <= 2) {
      startIdx++;
    }
    const startSilenceSec = startIdx > 0 ? Number((startIdx * secPerSample).toFixed(2)) : 0;

    // Detect trailing silence (samples <= 2 from end).
    let endIdx = totalSamples - 1;
    while (endIdx >= 0 && samples[endIdx] <= 2) {
      endIdx--;
    }
    const endSilenceSec =
      endIdx < totalSamples - 1 ? Number(((endIdx + 1) * secPerSample).toFixed(2)) : durationSec;

    const result = {
      startSilenceSec: startSilenceSec >= 1.5 ? startSilenceSec : 0,
      endSilenceSec: durationSec - endSilenceSec >= 2.0 ? endSilenceSec : durationSec,
    };

    waveformSilenceCache.set(waveformUrl, result);
    return result;
  } catch {
    return null;
  }
}
