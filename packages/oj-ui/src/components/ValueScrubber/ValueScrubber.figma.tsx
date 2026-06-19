import figma from '@figma/code-connect'
import { ValueScrubber } from './ValueScrubber'

figma.connect(ValueScrubber, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=22-18', {
  example: () => (<ValueScrubber />),
})
