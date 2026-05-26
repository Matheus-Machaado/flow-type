/**
 * Backward-compat alias for Icon (kept for SettingsApp.tsx which imports
 * SectionIcon by name). New code should import from ./Icon directly.
 */

import { Icon, type IconName } from './Icon'

export type SectionIconName = Extract<
  IconName,
  'keyboard' | 'mic' | 'cloud' | 'globe' | 'book' | 'zap' | 'info'
>

export function SectionIcon({
  name,
  size = 16,
  className
}: {
  name: SectionIconName
  size?: number
  className?: string
}): JSX.Element {
  return <Icon name={name} size={size} className={className} />
}
