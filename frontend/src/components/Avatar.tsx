// A cartoon portrait drawn in SVG, picked from the person's name so the same
// person always gets the same face. If they have an uploaded photo, show that.

const BG = ['#f8c7e2', '#cfe3d8', '#d9d1ec', '#f6e3a8', '#cfe0f5', '#f6d2c2']
const SKIN = ['#f5d6c0', '#eac0a0', '#d9a37f', '#b97f5a', '#8d5a3c', '#5e3a26']
const HAIR = ['#2b1d16', '#4a2f1f', '#7a4a26', '#b7793a', '#d9b26a', '#1f1f24', '#8a2f3c']
const SHIRT = ['#5c2529', '#3a4444', '#453b60', '#65451d', '#00356b', '#286dc0']

function hash(s: string) {
  let h = 2166136261
  for (const c of s.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

export function pastel(name: string) {
  return BG[hash(name) % BG.length]
}

export default function Avatar({ name, photo, size = 48 }: { name: string; photo?: string | null; size?: number }) {
  if (photo) {
    return <img className="avatar" src={photo} alt={name} width={size} height={size} style={{ width: size, height: size }} />
  }
  const h = hash(name)
  const pick = <T,>(arr: T[], shift: number) => arr[(h >>> shift) % arr.length]
  const bg = pick(BG, 0)
  const skin = pick(SKIN, 3)
  const hair = pick(HAIR, 6)
  const shirt = pick(SHIRT, 9)
  const style = (h >>> 12) % 5 // 0 short, 1 long, 2 bun, 3 curly, 4 bald-ish
  const glasses = (h >>> 15) % 4 === 0
  const couple = /&| and /i.test(name)

  const face = (dx: number, s = 1, k = 0) => {
    const sk = couple ? SKIN[(h >>> (3 + k * 5)) % SKIN.length] : skin
    const hr = couple ? HAIR[(h >>> (6 + k * 5)) % HAIR.length] : hair
    const st = couple ? (h >>> (12 + k * 3)) % 5 : style
    return (
      <g transform={`translate(${dx} 0) translate(50 50) scale(${s}) translate(-50 -50)`} key={k}>
        {/* back hair */}
        {st === 1 && <path d="M27 44 Q26 82 34 90 L66 90 Q74 82 73 44 Z" fill={hr} />}
        {st === 3 && <circle cx="50" cy="40" r="27" fill={hr} />}
        {/* shoulders */}
        <path d="M18 100 Q20 76 50 74 Q80 76 82 100 Z" fill={couple ? SHIRT[(h >>> (9 + k * 4)) % SHIRT.length] : shirt} />
        {/* neck + head */}
        <rect x="44" y="60" width="12" height="14" rx="5" fill={sk} />
        <ellipse cx="50" cy="46" rx="18" ry="20" fill={sk} />
        {/* front hair */}
        {st === 0 && <path d="M31 44 Q31 24 50 24 Q69 24 69 44 Q62 33 50 33 Q38 33 31 44 Z" fill={hr} />}
        {st === 1 && <path d="M31 46 Q30 23 50 23 Q70 23 69 46 Q63 30 44 32 Q36 36 31 46 Z" fill={hr} />}
        {st === 2 && (
          <>
            <circle cx="50" cy="20" r="9" fill={hr} />
            <path d="M31 43 Q32 25 50 25 Q68 25 69 43 Q60 31 50 31 Q40 31 31 43 Z" fill={hr} />
          </>
        )}
        {st === 3 && <path d="M30 42 Q34 26 50 27 Q66 26 70 42 Q64 34 50 34 Q36 34 30 42 Z" fill={hr} />}
        {st === 4 && <path d="M33 38 Q38 27 50 27 Q62 27 67 38 Q58 31 50 31 Q42 31 33 38 Z" fill={hr} opacity="0.8" />}
        {/* face */}
        <circle cx="43" cy="47" r="1.9" fill="#1d1d22" />
        <circle cx="57" cy="47" r="1.9" fill="#1d1d22" />
        <path d="M44 55 Q50 60 56 55" stroke="#1d1d22" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <circle cx="39" cy="53" r="2.6" fill="#e88" opacity="0.35" />
        <circle cx="61" cy="53" r="2.6" fill="#e88" opacity="0.35" />
        {glasses && !couple && (
          <g stroke="#1d1d22" strokeWidth="1.4" fill="none">
            <circle cx="43" cy="47" r="5" />
            <circle cx="57" cy="47" r="5" />
            <path d="M48 47 L52 47" />
          </g>
        )}
      </g>
    )
  }

  return (
    <svg className="avatar" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={name}>
      <rect width="100" height="100" fill={bg} />
      {couple ? [face(-16, 0.82, 0), face(16, 0.82, 1)] : face(0)}
    </svg>
  )
}
