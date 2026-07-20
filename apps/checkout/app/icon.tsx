import { ImageResponse } from 'next/og';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

/** Browser-tab favicon. */
export default function Icon() {
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
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: -1,
          fontFamily: 'sans-serif',
        }}
      >
        KH
      </div>
    ),
    { ...size },
  );
}
