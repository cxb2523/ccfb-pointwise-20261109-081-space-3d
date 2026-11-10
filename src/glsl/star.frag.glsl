#version 100
precision highp float;

// 星点 fragment：只做 billboard 径向软边缘，不再有任何逐像素噪声。
// 混合方式（additive）与 depthMask 在 CPU 渲染队列里配置。

varying vec3 vColor;
varying float vAlpha;
varying vec2 vCorner;

void main() {
    float r2 = dot(vCorner, vCorner);
    if (r2 >= 1.0) {
        discard;
    }
    float sprite = pow(1.0 - r2, 2.2);
    gl_FragColor = vec4(vColor, vAlpha * sprite);
}
