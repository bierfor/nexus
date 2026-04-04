/** Marca Puro Flusso para ImageResponse (favicon / Apple / PWA). */
export function BrandMarkOg({ size }: { size: number }) {
  const corner = Math.max(4, Math.round(size * 0.219));
  const gap = size * 0.062;
  const barW = size * 0.54;
  const barH = Math.max(3, size * 0.085);
  const shift = size * 0.048;
  const dot = size * 0.132;
  const pad = size * 0.156;

  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        position: "relative",
        alignItems: "center",
        justifyContent: "center",
        background: "#faf8f4",
        borderRadius: corner,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: barW,
            height: barH,
            borderRadius: barH / 2,
            background: "#1a1612",
            marginLeft: -shift,
          }}
        />
        <div
          style={{
            width: barW * 0.94,
            height: barH,
            borderRadius: barH / 2,
            background: "#1a1612",
          }}
        />
        <div
          style={{
            width: barW,
            height: barH,
            borderRadius: barH / 2,
            background: "#1a1612",
            marginLeft: shift,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          bottom: pad,
          right: pad,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          background: "#c45c26",
        }}
      />
    </div>
  );
}
