// The lens: edge-weighted displacement along the outward normal of the glass
// shape, run over the private backdrop replica `Glass.swift` draws inside that
// shape. It is what separates the material from a 2013 frost — slide a hard
// straight edge under a blur and it stays straight; under a lens it bows near
// the rim and snaps straight again in the middle.
//
// `.layerEffect` is iOS 17, not 26, which is the only reason any of this is
// possible on this target. It samples the view's OWN rasterised contents, so
// the thing being bent has to be something we drew ourselves.

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>

using namespace metal;

/// Signed distance to a rounded rectangle centred on the origin. Negative
/// inside, zero on the edge.
static float sdRoundRect(float2 p, float2 halfSize, float r) {
    float2 q = abs(p) - halfSize + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

[[stitchable]] half4 mmLens(float2 pos, SwiftUI::Layer layer,
                            float2 bandPeak, float2 size, float radius) {
    float band = bandPeak.x;
    float peak = bandPeak.y;

    float2 halfSize = size * 0.5;
    float2 p  = pos - halfSize;
    float  sd = sdRoundRect(p, halfSize, radius);

    // Interior early-out. Displacement is zero outside the rim band, and
    // returning here is what makes the lens a PERIMETER cost rather than an
    // area one: a 390x700 sheet is 26,160 rim pixels against 273,000 area
    // pixels, ten times cheaper, and that is what pays for it in the frame
    // budget.
    if (sd < -band) {
        return layer.sample(pos);
    }

    // Analytic central differences, not dfdx/dfdy. A screen-space derivative
    // taken after a conditional early return is undefined behaviour in
    // non-uniform control flow, and it shows up as artefacts at exactly the
    // band boundary. This one is computed from the distance field itself, so
    // the early return above cannot poison it.
    const float e = 1.0;
    float2 grad = float2(
        sdRoundRect(p + float2(e, 0.0), halfSize, radius) -
        sdRoundRect(p - float2(e, 0.0), halfSize, radius),
        sdRoundRect(p + float2(0.0, e), halfSize, radius) -
        sdRoundRect(p - float2(0.0, e), halfSize, radius));
    float2 n = normalize(grad + float2(1e-6));

    float t = clamp((sd + band) / band, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);        // smoothstep
    float off = peak * t * t;           // and squared: flat at the centre,
                                        // steep only in the last few pixels,
                                        // which is how real glass behaves and
                                        // why this does not read as fisheye.

    // About 0.6 px of chroma split — below the width at which anyone can name
    // it as fringing, and above the width at which it does nothing. Nameable
    // fringing is one of the twelve tells.
    half4 c  = layer.sample(pos - n * off);
    half4 cr = layer.sample(pos - n * (off + 0.6));
    half4 cb = layer.sample(pos - n * (off - 0.6));
    return half4(cr.r, c.g, cb.b, c.a);
}
