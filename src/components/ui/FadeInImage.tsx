import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties
} from "react";

import { cn } from "../../lib/cn";

type FadeInImageProps = ComponentPropsWithoutRef<"img"> & {
  visibleOpacity?: number;
};

type FadeInImageStyle = CSSProperties & {
  "--fade-in-image-opacity": number;
};

export const FadeInImage = forwardRef<HTMLImageElement, FadeInImageProps>(
  ({ className, onLoad, src, style, visibleOpacity = 1, ...props }, forwardedRef) => {
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [loadedSrc, setLoadedSrc] = useState<string>();
    const loaded = !!src && loadedSrc === src;
    const imageStyle = {
      ...style,
      "--fade-in-image-opacity": visibleOpacity
    } as FadeInImageStyle;
    const setImageRef = useCallback(
      (node: HTMLImageElement | null) => {
        imageRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef]
    );

    useEffect(() => {
      const image = imageRef.current;
      if (src && image?.complete && image.naturalWidth > 0) {
        setLoadedSrc(src);
      } else {
        setLoadedSrc(undefined);
      }
    }, [src]);

    return (
      <img
        {...props}
        ref={setImageRef}
        className={cn("fade-in-image", className)}
        src={src}
        style={imageStyle}
        data-load-state={loaded ? "loaded" : "loading"}
        onLoad={(event) => {
          setLoadedSrc(src);
          onLoad?.(event);
        }}
      />
    );
  }
);

FadeInImage.displayName = "FadeInImage";
