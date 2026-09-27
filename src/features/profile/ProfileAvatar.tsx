import { useState } from 'react'
import './profile.css'

const backgrounds = ['#cfe4d4', '#ffe1b9', '#d4d6f5', '#f6dcaf', '#c9e5ef', '#d9e5dd', '#e7dcf6', '#daebc3', '#c6e4e2', '#d8ddfa']
const coats = ['#54755e', '#da773c', '#444260', '#b58a56', '#34495d', '#81958e', '#f5edf9', '#faf9ed', '#8c654a', '#f4f5fc']

// Original, code-native portraits. Fixed palettes are artwork, not UI theme colors.
function Portrait({ preset }: { preset: number }) {
  const i = preset - 1
  return <svg viewBox="0 0 80 80" aria-hidden="true" focusable="false">
    <rect width="80" height="80" rx="40" fill={backgrounds[i]} />
    <circle cx="65" cy="15" r="16" fill="#fff" opacity=".2" />
    <path d="M8 80Q10 54 40 54Q70 54 72 80" fill={coats[i]} />
    {preset === 1 && <>
      <path d="M17 21L16 8L34 20L47 20L64 8L63 28" fill={coats[i]} />
      <ellipse cx="40" cy="42" rx="27" ry="28" fill={coats[i]} />
      <ellipse cx="28" cy="38" rx="13" ry="16" fill="#f6efda" /><ellipse cx="52" cy="38" rx="13" ry="16" fill="#f6efda" />
      <path d="M35 46L40 54L45 46" fill="#d4a24f" />
    </>}
    {preset === 2 && <>
      <path d="M15 35L12 9L34 23L46 23L68 9L65 35Q65 58 40 67Q15 58 15 35" fill={coats[i]} />
      <path d="M18 16L20 31L29 25M62 16L60 31L51 25" fill="#663e37" />
      <path d="M15 38Q32 38 40 54Q48 38 65 38Q63 57 40 67Q17 57 15 38" fill="#fff1d9" />
      <path d="M35 54Q40 50 45 54L40 59Z" fill="#422f2c" />
    </>}
    {preset === 3 && <>
      <path d="M15 37L15 10L33 22L47 22L65 10L65 40Q65 64 40 66Q15 64 15 37" fill={coats[i]} />
      <path d="M20 18L21 30L29 25M60 18L59 30L51 25" fill="#ca9bac" />
      <ellipse cx="40" cy="53" rx="13" ry="10" fill="#a8a3be" /><path d="M36 48L44 48L40 53Z" fill="#42324a" />
      <path d="M10 47L28 50M10 54L27 54M52 50L70 47M53 54L70 54" stroke="#cbc5dc" strokeWidth="2" />
    </>}
    {preset === 4 && <>
      <circle cx="20" cy="23" r="12" fill={coats[i]} /><circle cx="60" cy="23" r="12" fill={coats[i]} />
      <circle cx="20" cy="23" r="6" fill="#785439" /><circle cx="60" cy="23" r="6" fill="#785439" />
      <ellipse cx="40" cy="43" rx="26" ry="27" fill={coats[i]} /><ellipse cx="40" cy="53" rx="14" ry="11" fill="#f6dcaf" />
      <ellipse cx="40" cy="50" rx="6" ry="4" fill="#453429" />
    </>}
    {preset === 5 && <>
      <ellipse cx="40" cy="43" rx="26" ry="31" fill={coats[i]} />
      <path d="M20 42Q20 18 40 32Q60 18 60 42L59 61Q40 73 21 61Z" fill="#f5f3e9" />
      <path d="M34 48L46 48L40 55Z" fill="#e3a24b" />
    </>}
    {preset === 6 && <>
      <circle cx="15" cy="29" r="14" fill={coats[i]} /><circle cx="65" cy="29" r="14" fill={coats[i]} />
      <circle cx="15" cy="29" r="9" fill="#c7d5cb" /><circle cx="65" cy="29" r="9" fill="#c7d5cb" />
      <ellipse cx="40" cy="42" rx="25" ry="27" fill={coats[i]} /><ellipse cx="40" cy="46" rx="7" ry="10" fill="#344640" />
    </>}
    {preset === 7 && <>
      <ellipse cx="27" cy="23" rx="9" ry="23" fill={coats[i]} /><ellipse cx="53" cy="23" rx="9" ry="23" fill={coats[i]} />
      <ellipse cx="27" cy="21" rx="4" ry="15" fill="#deb3c5" /><ellipse cx="53" cy="21" rx="4" ry="15" fill="#deb3c5" />
      <ellipse cx="40" cy="48" rx="25" ry="24" fill={coats[i]} /><path d="M36 52L44 52L40 57Z" fill="#c38b9e" />
    </>}
    {preset === 8 && <>
      <circle cx="20" cy="23" r="11" fill="#394b40" /><circle cx="60" cy="23" r="11" fill="#394b40" />
      <ellipse cx="40" cy="43" rx="27" ry="27" fill={coats[i]} />
      <ellipse cx="28" cy="39" rx="10" ry="12" fill="#394b40" /><ellipse cx="52" cy="39" rx="10" ry="12" fill="#394b40" />
      <path d="M35 53Q40 49 45 53L40 58Z" fill="#394b40" />
    </>}
    {preset === 9 && <>
      <circle cx="18" cy="29" r="9" fill={coats[i]} /><circle cx="62" cy="29" r="9" fill={coats[i]} />
      <ellipse cx="40" cy="43" rx="26" ry="25" fill={coats[i]} /><ellipse cx="40" cy="53" rx="18" ry="12" fill="#e9d4b7" />
      <ellipse cx="40" cy="49" rx="6" ry="4" fill="#493a31" /><path d="M16 51L28 53M52 53L64 51" stroke="#493a31" strokeWidth="2" />
    </>}
    {preset === 10 && <>
      <circle cx="40" cy="39" r="29" fill={coats[i]} /><rect x="17" y="19" width="46" height="39" rx="18" fill="#3c536d" />
      <path d="M25 28Q34 20 45 26" fill="none" stroke="#b8d9ea" strokeWidth="4" strokeLinecap="round" />
      <rect x="28" y="66" width="24" height="10" rx="3" fill="#c5cdeb" /><circle cx="46" cy="71" r="2" fill="#da875c" />
    </>}
    {preset !== 10 && <>
      <circle cx="28" cy={preset === 7 ? 45 : 39} r="3" fill={preset === 8 ? '#fff' : '#23322d'} />
      <circle cx="52" cy={preset === 7 ? 45 : 39} r="3" fill={preset === 8 ? '#fff' : '#23322d'} />
      <path d="M36 59Q40 63 44 59" stroke="#23322d" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </>}
  </svg>
}

export function ProfileAvatar({ preset = 1, imageUrl, size = 36 }: { preset?: number; imageUrl?: string | null; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  return <span className="profile-avatar" style={{ width: size, height: size }}>
    {imageUrl && failed !== imageUrl
      ? <img src={imageUrl} alt="" onError={() => setFailed(imageUrl)} />
      : <Portrait preset={preset >= 1 && preset <= 10 ? preset : 1} />}
  </span>
}
