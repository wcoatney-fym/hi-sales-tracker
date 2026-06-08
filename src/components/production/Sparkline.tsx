interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export default function Sparkline({ data, width = 80, height = 24, color }: SparklineProps) {
  if (!data.length) return <div style={{ width, height }} />;

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });

  const trend = data.length >= 2 ? data[data.length - 1] - data[0] : 0;
  const strokeColor = color || (trend > 0 ? "#34d399" : trend < 0 ? "#f87171" : "#94a3b8");

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
