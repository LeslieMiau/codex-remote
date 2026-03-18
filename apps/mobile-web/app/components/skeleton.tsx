"use client";

export function Skeleton({
  width,
  height,
  radius
}: {
  width?: string;
  height?: string;
  radius?: string;
}) {
  return (
    <div
      className="codex-skeleton"
      style={{
        width: width ?? "100%",
        height: height ?? "16px",
        borderRadius: radius ?? "8px"
      }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="codex-skeleton-card">
      <Skeleton width="35%" height="12px" />
      <Skeleton width="75%" height="22px" />
      <Skeleton width="55%" height="14px" />
      <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
        <Skeleton width="80px" height="32px" radius="999px" />
        <Skeleton width="100px" height="32px" radius="999px" />
      </div>
    </div>
  );
}
