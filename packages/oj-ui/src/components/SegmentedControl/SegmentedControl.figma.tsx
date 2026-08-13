import figma from '@figma/code-connect'
import { SegmentedControl, Tabs } from './SegmentedControl'

figma.connect(SegmentedControl, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=10-13', {
  example: () => (<SegmentedControl />),
})

figma.connect(Tabs, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=10-25', {
  example: () => (<Tabs />),
})
