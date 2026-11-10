#version 100
precision highp float;

// 三层视差星空（单 draw call）
// 层间的密度/尺寸/alpha 差异全部在 CPU 侧烘焙进 aColor/aScale，
// vertex shader 不按 aLayer 做分支，aLayer 仅作调试/回退标记。

uniform mat4 uView;
uniform mat4 uProjection;
uniform float uTime;
uniform float uTwinkle;

// 相机空间距离渐隐区间（世界单位），由 CPU 按 far plane 与近层尺度计算
uniform float uFadeNearStart;
uniform float uFadeNearEnd;
uniform float uFadeFarStart;
uniform float uFadeFarEnd;

attribute vec3 aPosition;   // 星点中心（世界坐标）
attribute vec4 aColor;      // rgb + 基础 alpha（已含所在层的 alpha 区间）
attribute vec2 aCorner;     // billboard 四角方向 [-1, 1]
attribute float aLayer;     // 0=暗远 1=中等 2=亮近
attribute float aPhase;     // CPU 预计算的闪烁相位
attribute float aFrequency; // CPU 预计算的闪烁基础频率
attribute float aScale;     // CPU 按层分配的 billboard 半边长（世界单位）

varying vec3 vColor;
varying float vAlpha;
varying vec2 vCorner;

void main() {
    vec4 viewCenter = uView * vec4(aPosition, 1.0);
    float dist = -viewCenter.z;

    // far plane 边缘按相机距离平滑渐隐，不硬切；
    // 近端渐隐终点与近层最小半径/最大尺寸在 CPU 侧衔接，避免缩没或亮度断层。
    float nearFade = smoothstep(uFadeNearStart, uFadeNearEnd, dist);
    float farFade = 1.0 - smoothstep(uFadeFarStart, uFadeFarEnd, dist);
    float distFade = nearFade * farFade;

    // 相位与频率都是 CPU 预算好的顶点属性，这里只做正弦叠加。
    // 调 ?twinkle 只缩放 uTwinkle，不重建缓冲，星点不会集体跳变。
    // aLayer 无分支地参与幅度调制：暗远层闪烁幅度略大，亮近层更稳。
    float layerMod = 1.0 - 0.15 * (aLayer / 2.0);
    float t = uTime * aFrequency * uTwinkle;
    float twinkle = (0.5
        + 0.35 * sin(t + aPhase)
        + 0.15 * sin(t * 2.7 + aPhase * 1.3)) * layerMod;

    vColor = aColor.rgb;
    vAlpha = aColor.a * twinkle * distFade;
    vCorner = aCorner;

    // 视图空间 billboard：世界尺寸固定，透视下近大远小，推进时天然带出纵深。
    vec4 viewPos = viewCenter;
    viewPos.xy += aCorner * aScale;
    gl_Position = uProjection * viewPos;
}
