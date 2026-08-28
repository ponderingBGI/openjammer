import figma from '@figma/code-connect'
import { SegmentedControl, Tabs } from './SegmentedControl'

const OPTIONS = [
  { value: 'stable', label: 'Stable' },
  { value: 'beta', label: 'Beta' },
]

figma.connect(SegmentedControl, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=10-13', {
  example: () => (
    <SegmentedControl aria-label="Release channel" options={OPTIONS} value="stable" onChange={() => {}} />
  ),
})

figma.connect(Tabs, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=10-25', {
  example: () => (
    <Tabs aria-label="Settings section" options={OPTIONS} value="stable" onChange={() => {}} />
  ),
})
