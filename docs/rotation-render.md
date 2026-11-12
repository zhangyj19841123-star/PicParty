# Native photo rotation

Photo rotation is a nondestructive placement property, separate from the EXIF orientation applied when decoding the original. The shared geometry engine resolves a clockwise angle in degrees, an image center in page coordinates, and the complete oriented photo's unrotated rendered width and height. It enlarges the minimum cover scale as necessary to fill the rotated frame and constrains the effective focus.

Native export uses the same image center and inverse clockwise transform as the Canvas/Konva preview. Each output pixel center maps back to the oriented source image. The resolved source bounding box is not used as a crop for rotated images, because that would discard corners or shift the rotation center.

At zero degrees, export retains the existing fractional Lanczos3 crop renderer. At other angles, any shrinking first uses Lanczos3 at approximately the target pixel density, in linear-light, 16-bit premultiplied RGBA. Bilinear inverse-affine sampling then rotates that bitmap in 128-row strips. Enlarged photos are sampled directly from the original instead of allocating an enlarged intermediate. Samples outside the image are transparent; valid edge samples use edge extension. Every strip is clipped to the resolved photo frame and composited onto the opaque page background in linear light.

The shrinking path checks its source, reduced bitmap, convolution scratch, output strip, page bitmap, and bookkeeping against the existing 1.5 GiB work budget before allocating the reduced bitmap. Cancellation is checked during convolution strips, affine rows, and before output commit. The original is fingerprint-checked by the existing decoder and is never rewritten.

Native tests exercise clockwise quarter-turn pixels, arbitrary-angle alpha preservation and frame clipping, checkerboard minification, identical sampling across strip boundaries, cancellation, budget rejection, rotated project round trips, and a real 4000 × 6000 px PNG export with sRGB metadata.
