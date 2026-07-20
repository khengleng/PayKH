import { ImageResponse } from 'next/og';

/**
 * PWA app icon, size-parameterized (?size=192|512). Referenced by the manifest.
 * Full-bleed indigo so it survives the Android adaptive (maskable) crop, with the
 * "KH" monogram in the center safe zone.
 */
export function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get('size') ?? 512);
  const size = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 1024) : 512;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg,#6366f1,#4338ca)',
          color: 'white',
          fontSize: Math.round(size * 0.42),
          fontWeight: 800,
          letterSpacing: -2,
          fontFamily: 'sans-serif',
        }}
      >
        KH
      </div>
    ),
    { width: size, height: size },
  );
}
