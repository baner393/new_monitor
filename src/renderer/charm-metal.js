/**
 * 金属侧壁：轮廓法线 → reflect → 棚拍环境亮暗带。
 * 原理参考 Three.js 的 MIT 实现（未引入依赖或复制源码）：
 * https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/envmap_physical_pars_fragment.glsl.js
 * https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/bsdfs.glsl.js
 * https://github.com/mrdoob/three.js/blob/dev/LICENSE
 */
export const METAL_VERTEX = `
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
attribute vec2 aContourSlope;
attribute float aDepthCoordinate;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform mat3 uTextureMatrix;
varying vec2 vTextureCoord;
varying vec2 vContourSlope;
varying float vDepthCoordinate;
void main(void) {
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = (uTextureMatrix * vec3(aTextureCoord, 1.0)).xy;
    vContourSlope = aContourSlope;
    vDepthCoordinate = aDepthCoordinate;
}`;

export const METAL_FRAGMENT = `
precision mediump float;
varying vec2 vTextureCoord;
varying vec2 vContourSlope;
varying float vDepthCoordinate;
uniform sampler2D uSampler;
uniform vec4 uColor;
uniform vec2 uMetalYaw;
uniform vec2 uMetalRotation;
uniform float uMetalDepth;
uniform float uMetalBandWidth;
uniform float uMetalDepthDirection;
uniform float uMetalHeight;

float panel(float angle, float center, float width) {
    float distance = atan(sin(angle - center), cos(angle - center));
    return exp(-pow(distance / width, 2.0));
}
float studio(float angle) {
    // 深色环境映出宽软箱、窄灯条和暗遮光板，避免塑料式均匀漫反射。
    return 0.20 + 0.72 * panel(angle, 0.62, 0.48)
        + 1.35 * panel(angle, -0.28, 0.075)
        + 0.28 * panel(angle, -1.5, 0.55)
        - 0.10 * panel(angle, 1.6, 0.24);
}
void main(void) {
    float side = uMetalYaw.y >= 0.0 ? -1.0 : 1.0;
    float slope = side < 0.0 ? vContourSlope.x : vContourSlope.y;
    vec3 normal = normalize(vec3(side, -side * slope, 0.0));
    float depth = uMetalDepth + (vDepthCoordinate - 0.5) * uMetalBandWidth * uMetalDepthDirection;
    float bevel = max(0.0, 1.0 - min(depth, 1.0 - depth) / 0.085);
    // 侧壁微弧与两端倒角令灯条沿厚度出现连续窄高光，而不是两条亮边。
    normal = normalize(normal + vec3(0.0, 0.0, (depth - 0.5) * 0.42
        + bevel * (depth < 0.5 ? 0.7 : -0.7)));
    normal = vec3(normal.x * uMetalYaw.x + normal.z * uMetalYaw.y,
        normal.y, -normal.x * uMetalYaw.y + normal.z * uMetalYaw.x);
    normal.xy = vec2(normal.x * uMetalRotation.x - normal.y * uMetalRotation.y,
        normal.x * uMetalRotation.y + normal.y * uMetalRotation.x);
    vec3 reflected = reflect(vec3(0.0, 0.0, -1.0), normal);
    float angle = atan(reflected.x, reflected.z) + reflected.y * 0.8
        + (vTextureCoord.y - 0.5) * 0.18;
    // 固定粗糙度的环境卷积近似，让窄高光有边界且不会整片白闪。
    float environment = studio(angle) * 0.6
        + (studio(angle - 0.065) + studio(angle + 0.065)) * 0.2;
    float fresnel = 0.84 + 0.16 * pow(1.0 - abs(normal.z), 5.0);
    float brush = 0.99 + 0.012 * sin(vTextureCoord.y * uMetalHeight * 2.1
        + vTextureCoord.x * 24.0);
    vec3 silver = vec3(0.91, 0.95, 1.0) * max(0.18, environment * fresnel) * brush;
    vec4 texel = texture2D(uSampler, vTextureCoord);
    float alpha = texel.a * uColor.a;
    // 输出预乘 alpha；纹理 RGB 不再承担固定灰渐变，轮廓 alpha 保留。
    gl_FragColor = vec4(sqrt(clamp(silver, 0.0, 1.0)) * uColor.rgb * texel.a, alpha);
}`;

export function updateMetalUniforms(uniforms, state, depth) {
  const rotation = state.tilt + state.spinZ * 0.55;
  uniforms.uMetalYaw[0] = Math.cos(state.spinY);
  uniforms.uMetalYaw[1] = Math.sin(state.spinY);
  uniforms.uMetalRotation[0] = Math.cos(rotation);
  uniforms.uMetalRotation[1] = Math.sin(rotation);
  uniforms.uMetalDepth = depth;
}
