import { BIRD_PATH, MARK_VIEWBOX } from './logoPaths'

export function Bird({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox={MARK_VIEWBOX} aria-hidden fill="currentColor" fillRule="evenodd">
      <path d={BIRD_PATH} />
    </svg>
  )
}
