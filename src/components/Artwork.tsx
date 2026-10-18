import { useEffect, useState } from 'react';
import { Music } from 'lucide-react';

interface ArtworkProps {
  src?: string | null;
  seed?: string | number;
  /**
   * Only these rendition sizes actually exist on SoundCloud's CDN. Measured:
   * 100, 150, 400, 600 and 1000 all answer 404, so requesting a size outside
   * this set produces a blank tile.
   */
  size?: 67 | 80 | 120 | 200 | 250 | 300 | 500;
  className?: string;
  rounded?: string;
}

const GRADIENTS = [
  'from-indigo-500 to-cyan-600',
  'from-violet-500 to-blue-700',
  'from-teal-400 to-indigo-700',
  'from-fuchsia-500 to-indigo-700',
  'from-emerald-500 to-teal-700',
  'from-sky-500 to-blue-700',
  'from-violet-500 to-purple-800',
  'from-cyan-500 to-indigo-800',
];

function hash(seed: string | number): number {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function renditions(src: string, size: number): string[] {
  const sized = src.replace('-large.jpg', `-t${size}x${size}.jpg`);
  // Fall back to the original asset if the requested rendition is missing.
  return sized === src ? [src] : [sized, src];
}

/**
 * SoundCloud returns `artwork_url: null` for many tracks and playlists, so a
 * plain `{src && <img/>}` leaves holes in the grid. Renders a deterministic
 * gradient derived from the seed when there is no usable image.
 */
export function Artwork({
  src,
  seed = '',
  size = 200,
  className = '',
  rounded = 'rounded-lg',
}: ArtworkProps) {
  const [index, setIndex] = useState(0);
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    setUrls(src ? renditions(src, size) : []);
    setIndex(0);
  }, [src, size]);

  const url = urls[index];
  const gradient = GRADIENTS[hash(seed) % GRADIENTS.length];

  if (!src || !url) {
    return (
      <div
        className={`${rounded} bg-gradient-to-br ${gradient} ${className} flex items-center justify-center overflow-hidden`}
        aria-hidden
      >
        <Music className="h-1/3 w-1/3 text-sc-fg/35" strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setIndex((i) => i + 1)}
      className={`${rounded} ${className} object-cover`}
    />
  );
}