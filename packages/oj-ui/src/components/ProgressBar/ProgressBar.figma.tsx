import figma from '@figma/code-connect'
import { ProgressBar } from './ProgressBar'

figma.connect(ProgressBar, 'https://www.figma.com/design/ayHEMsJL1BPhvTYWi1CFJs?node-id=6-11', {
  example: () => (<ProgressBar value={0.6} />),
})
