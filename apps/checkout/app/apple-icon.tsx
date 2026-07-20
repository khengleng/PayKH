import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** iOS home-screen icon (auto-injected as apple-touch-icon). */
export default function AppleIcon() {
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
          fontSize: 78,
          fontWeight: 800,
          letterSpacing: -2,
          fontFamily: 'sans-serif',
        }}
      >
        KH
      </div>
    ),
    { ...size },
  );
}
