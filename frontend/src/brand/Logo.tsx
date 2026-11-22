import { BIRD_PATH, LOGO_VIEWBOX, WORD_PATH } from './logoPaths'

export function Logo({ className, tone = 'blue' }: { className?: string; tone?: 'blue' | 'white' }) {
  return (
    <svg className={className} viewBox={LOGO_VIEWBOX} role="img" aria-label="BIOCANARY" fill={tone === 'white' ? '#fff' : '#254F91'} fillRule="evenodd">
      <path d={BIRD_PATH} />
      <path d={WORD_PATH} />
    </svg>
  )
}
