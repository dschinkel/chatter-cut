import { useEffect, useRef, useState } from 'react'

const VERTEX_SHADER = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;
varying vec2 uv;
uniform float time;
uniform float monochrome;

void glow(inout vec3 color, vec2 point, vec2 center, vec2 radius, vec3 tint, float strength) {
  vec2 distance = (point - center) / radius;
  color = mix(color, tint, exp(-dot(distance, distance) * 3.0) * strength);
}

void main() {
  vec2 screen = vec2(uv.x, 1.0 - uv.y);
  float phase = time * 6.2831853 / 24.0;
  float angle = sin(phase) * 0.38;
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 point = rotation * (screen - 0.5) / (1.28 + sin(phase * 0.7) * 0.17) + 0.5;
  point += vec2(sin(phase) * 0.16, cos(phase) * 0.14);

  vec3 color = mix(vec3(0.035, 0.047, 0.086), vec3(0.0), monochrome);
  glow(color, point, vec2(0.45, 0.35), vec2(0.64, 0.55), vec3(0.643, 0.294, 1.0), 0.58);
  glow(color, point, vec2(0.0, 0.58), vec2(0.50, 0.60), vec3(0.298, 0.431, 1.0), 0.65);
  glow(color, point, vec2(0.20, 0.95), vec2(0.62, 0.48), vec3(0.180, 0.796, 1.0), 0.65);
  glow(color, point, vec2(0.80, 0.85), vec2(0.56, 0.52), vec3(0.188, 0.878, 0.569), 0.60);
  glow(color, point, vec2(0.98, 0.46), vec2(0.48, 0.62), vec3(1.0, 0.867, 0.290), 0.58);
  glow(color, point, vec2(0.78, 0.08), vec2(0.58, 0.46), vec3(1.0, 0.569, 0.224), 0.65);
  glow(color, point, vec2(0.08, 0.18), vec2(0.58, 0.52), vec3(1.0, 0.235, 0.459), 0.70);

  // Rotate the rainbow around its neutral axis; grayscale shares the same field.
  vec3 axis = normalize(vec3(1.0));
  float hue = time * 6.2831853 / 48.0;
  color = color * cos(hue) + cross(axis, color) * sin(hue)
    + axis * dot(axis, color) * (1.0 - cos(hue));
  color = clamp(color, 0.0, 1.0);
  float shade = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(color * 1.2, vec3(shade * 0.42), monochrome);
  color *= 0.825 + sin(time * 6.2831853 / 18.0) * 0.175;
  float edge = smoothstep(0.1, 1.1, length((screen - vec2(0.5, 0.3)) / vec2(0.72, 0.85)));
  color *= 1.0 - edge * mix(0.65, 0.85, monochrome);

  // Dither at each physical display pixel to smooth even low-bit-depth panels.
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  color += (noise - 0.5) * (4.0 / 255.0);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`

export function WaveBackdrop({ monochrome }: { monochrome: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const monochromeRef = useRef(monochrome)
  const redrawRef = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(false)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const gl = canvas?.getContext('webgl', { alpha: false, antialias: false, depth: false })
    if (!canvas || !gl) return

    const shaders: WebGLShader[] = []
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
    }
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    const buffer = gl.createBuffer()
    const release = () => {
      shaders.forEach(shader => gl.deleteShader(shader))
      if (program) gl.deleteProgram(program)
      if (buffer) gl.deleteBuffer(buffer)
    }
    if (!vertex || !fragment || !program || !buffer) {
      release()
      return
    }
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      release()
      return
    }
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const timeUniform = gl.getUniformLocation(program, 'time')
    const monochromeUniform = gl.getUniformLocation(program, 'monochrome')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0

    const draw = () => {
      if (gl.isContextLost()) return
      gl.uniform1f(timeUniform, reducedMotion.matches ? 0 : performance.now() / 1000)
      gl.uniform1f(monochromeUniform, monochromeRef.current ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    redrawRef.current = draw
    const resize = () => {
      if (gl.isContextLost()) return
      const density = window.devicePixelRatio || 1
      const bounds = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(bounds.width * density))
      canvas.height = Math.max(1, Math.round(bounds.height * density))
      gl.viewport(0, 0, canvas.width, canvas.height)
      draw()
    }
    const animate = () => {
      draw()
      frame = requestAnimationFrame(animate)
    }
    const updateMotion = () => {
      cancelAnimationFrame(frame)
      if (gl.isContextLost()) return
      draw()
      if (!reducedMotion.matches && !document.hidden) frame = requestAnimationFrame(animate)
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      cancelAnimationFrame(frame)
      setReady(false)
    }
    const contextRestored = () => setGeneration(value => value + 1)
    let densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    const updateDensity = () => {
      densityQuery.removeEventListener('change', updateDensity)
      densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      densityQuery.addEventListener('change', updateDensity)
      resize()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    updateMotion()
    setReady(true)
    window.addEventListener('resize', resize)
    reducedMotion.addEventListener('change', updateMotion)
    document.addEventListener('visibilitychange', updateMotion)
    canvas.addEventListener('webglcontextlost', contextLost)
    canvas.addEventListener('webglcontextrestored', contextRestored)
    densityQuery.addEventListener('change', updateDensity)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', resize)
      reducedMotion.removeEventListener('change', updateMotion)
      document.removeEventListener('visibilitychange', updateMotion)
      canvas.removeEventListener('webglcontextlost', contextLost)
      canvas.removeEventListener('webglcontextrestored', contextRestored)
      densityQuery.removeEventListener('change', updateDensity)
      redrawRef.current = null
      release()
    }
  }, [generation])

  useEffect(() => {
    monochromeRef.current = monochrome
    redrawRef.current?.()
  }, [monochrome])

  return <div className="rainbow-backdrop" data-renderer={ready ? 'webgl' : 'css'} aria-hidden="true">
    <canvas ref={canvasRef} className="wave-backdrop" />
  </div>
}
