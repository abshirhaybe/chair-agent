"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A resilient product image. Shows a shimmer skeleton until the photo loads,
 * and swaps to a branded gradient placeholder (never a broken-image icon) if the
 * remote photo fails to load. The element fills its (aspect-ratio'd) parent.
 */
export function ProductImage({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const imgRef = useRef<HTMLImageElement>(null);

  // A cached image can finish loading before React attaches onLoad (common with
  // SSR'd markup), leaving status stuck on "loading" and the image invisible.
  // Catch that by checking the element's load state on mount / when src changes.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) {
      setStatus(img.naturalWidth > 0 ? "loaded" : "error");
    } else {
      setStatus("loading");
    }
  }, [src]);

  if (status === "error") {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-100 via-white to-sky-100 ${className}`}
        aria-label={alt}
        role="img"
      >
        <ChairGlyph className="h-12 w-12 text-[var(--brand)]/50" />
      </div>
    );
  }

  return (
    <>
      {status === "loading" && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-stone-100 to-stone-200" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={`h-full w-full object-cover transition-opacity duration-500 ${
          status === "loaded" ? "opacity-100" : "opacity-0"
        } ${className}`}
      />
    </>
  );
}

function ChairGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
      <path d="M7 4v8m10-8v8M6 12h12M8 12l-1 6m9-6l1 6M9 20h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
